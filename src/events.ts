import { MAX_EVENTS_BLOCK_SPAN } from "./config.js";
import { searchTxsByContractAndHeight, type TxResponse } from "./lcd.js";
import { listPairs, getPoolReserves, type ResolvedPair } from "./pairs.js";
import type { IndexedEvent, Block } from "./types.js";
import {
  decimalize,
  normalizeAssetAttr,
  parseIsoToUnix,
  splitWasmSections,
} from "./utils.js";

const JOIN_ACTIONS = new Set([
  "provide_liquidity",
  "join_pool",
  "add_liquidity",
]);
const EXIT_ACTIONS = new Set([
  "withdraw_liquidity",
  "exit_pool",
  "remove_liquidity",
]);

function blockFromTx(tx: TxResponse): Block {
  const blockNumber = Number(tx.height);
  const blockTimestamp =
    parseIsoToUnix(tx.timestamp) ?? Math.floor(Date.now() / 1000);
  return { blockNumber, blockTimestamp };
}

function collectWasmSections(tx: TxResponse): Array<{
  section: Record<string, string>;
  msgIndex: number;
  eventIndex: number;
}> {
  const out: Array<{
    section: Record<string, string>;
    msgIndex: number;
    eventIndex: number;
  }> = [];
  let globalEventIndex = 0;

  const logs = tx.logs;
  if (logs && logs.length) {
    for (const log of logs) {
      const msgIndex = log.msg_index ?? 0;
      for (const ev of log.events || []) {
        if (ev.type !== "wasm" && ev.type !== "from_contract") continue;
        const sections = splitWasmSections(ev.attributes || []);
        for (const section of sections) {
          out.push({
            section,
            msgIndex,
            eventIndex: globalEventIndex++,
          });
        }
      }
    }
    return out;
  }

  for (const ev of tx.events || []) {
    if (ev.type !== "wasm" && ev.type !== "from_contract") continue;
    const sections = splitWasmSections(ev.attributes || []);
    for (const section of sections) {
      const msgIndex = Number(section.msg_index || 0);
      out.push({ section, msgIndex, eventIndex: globalEventIndex++ });
    }
  }
  return out;
}

function pickMaker(section: Record<string, string>, tx: TxResponse): string {
  return (
    section.sender ||
    section.receiver ||
    section.from ||
    (() => {
      const msgs = tx.tx?.body?.messages || [];
      for (const m of msgs) {
        if (typeof m.sender === "string") return m.sender;
      }
      return "unknown";
    })()
  );
}

async function reservesForSwap(
  pair: ResolvedPair,
  section: Record<string, string>,
  siblings: Array<Record<string, string>>,
  height: number,
): Promise<{ r0Raw: string; r1Raw: string; source: string }> {
  for (const s of [section, ...siblings]) {
    if (
      s._contract_address === pair.pair.id &&
      s.reserve0 != null &&
      s.reserve1 != null &&
      s.reserve0 !== "0" &&
      s.reserve1 !== "0"
    ) {
      return { r0Raw: s.reserve0, r1Raw: s.reserve1, source: "event" };
    }
  }
  for (const s of siblings) {
    if (s._contract_address !== pair.pair.id) continue;
    if (s.backing_after_0 && s.local_cwlunc_after) {
      return {
        r0Raw: s.backing_after_0,
        r1Raw: s.local_cwlunc_after,
        source: "rebalance_attrs",
      };
    }
  }

  try {
    const { reserve0, reserve1 } = await getPoolReserves(pair.pair.id, height);
    return {
      r0Raw: reserve0,
      r1Raw: reserve1,
      source: pair.bondingCurve ? "curve_info" : "pool_query",
    };
  } catch {
    const { reserve0, reserve1 } = await getPoolReserves(pair.pair.id);
    return {
      r0Raw: reserve0,
      r1Raw: reserve1,
      source: pair.bondingCurve ? "curve_info_tip" : "pool_query_tip",
    };
  }
}

function buildSwapEvent(opts: {
  pair: ResolvedPair;
  section: Record<string, string>;
  tx: TxResponse;
  txnIndex: number;
  eventIndex: number;
  r0Raw: string;
  r1Raw: string;
}): IndexedEvent | null {
  const { pair, section, tx, txnIndex, eventIndex, r0Raw, r1Raw } = opts;
  const offerId = normalizeAssetAttr(section.offer_asset);
  const askId = normalizeAssetAttr(
    section.ask_asset || section.return_asset,
  );
  const offerAmount = section.offer_amount;
  const returnAmount = section.return_amount;
  if (!offerId || !askId || !offerAmount || !returnAmount) return null;
  if (offerAmount === "0" || returnAmount === "0") return null;

  const asset0 = pair.pair.asset0Id;
  const asset1 = pair.pair.asset1Id;
  const d0 = pair.asset0Decimals;
  const d1 = pair.asset1Decimals;

  let asset0In: string | undefined;
  let asset1Out: string | undefined;
  let asset1In: string | undefined;
  let asset0Out: string | undefined;

  if (offerId === asset0 && askId === asset1) {
    asset0In = decimalize(offerAmount, d0);
    asset1Out = decimalize(returnAmount, d1);
  } else if (offerId === asset1 && askId === asset0) {
    asset1In = decimalize(offerAmount, d1);
    asset0Out = decimalize(returnAmount, d0);
  } else {
    return null;
  }

  const reserve0 = decimalize(r0Raw, d0);
  const reserve1 = decimalize(r1Raw, d1);
  if (reserve0 === "0" || reserve1 === "0") return null;

  return {
    block: blockFromTx(tx),
    eventType: "swap",
    txnId: tx.txhash,
    txnIndex,
    eventIndex,
    maker: pickMaker(section, tx),
    pairId: pair.pair.id,
    ...(asset0In != null ? { asset0In } : {}),
    ...(asset1Out != null ? { asset1Out } : {}),
    ...(asset1In != null ? { asset1In } : {}),
    ...(asset0Out != null ? { asset0Out } : {}),
    reserves: { asset0: reserve0, asset1: reserve1 },
  };
}

function buildJoinExit(opts: {
  pair: ResolvedPair;
  section: Record<string, string>;
  tx: TxResponse;
  txnIndex: number;
  eventIndex: number;
  eventType: "join" | "exit";
  r0Raw: string;
  r1Raw: string;
}): IndexedEvent | null {
  const { pair, section, tx, txnIndex, eventIndex, eventType, r0Raw, r1Raw } =
    opts;
  let amount0Raw = section.amount0 || section.offer_amount_0;
  let amount1Raw = section.amount1 || section.offer_amount_1;

  if ((!amount0Raw || !amount1Raw) && section.assets) {
    try {
      const parsed = JSON.parse(section.assets);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        amount0Raw = parsed[0].amount || amount0Raw;
        amount1Raw = parsed[1].amount || amount1Raw;
      }
    } catch {
      /* ignore */
    }
  }

  if ((!amount0Raw || !amount1Raw) && section.refund_assets) {
    try {
      const parsed = JSON.parse(section.refund_assets);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        amount0Raw = parsed[0].amount || amount0Raw;
        amount1Raw = parsed[1].amount || amount1Raw;
      }
    } catch {
      /* ignore */
    }
  }

  if (!amount0Raw || !amount1Raw) return null;
  if (amount0Raw === "0" && amount1Raw === "0") return null;

  const reserve0 = decimalize(r0Raw, pair.asset0Decimals);
  const reserve1 = decimalize(r1Raw, pair.asset1Decimals);
  if (reserve0 === "0" || reserve1 === "0") return null;

  return {
    block: blockFromTx(tx),
    eventType,
    txnId: tx.txhash,
    txnIndex,
    eventIndex,
    maker: pickMaker(section, tx),
    pairId: pair.pair.id,
    amount0: decimalize(amount0Raw, pair.asset0Decimals),
    amount1: decimalize(amount1Raw, pair.asset1Decimals),
    reserves: { asset0: reserve0, asset1: reserve1 },
  };
}

async function parseTxForPair(
  pair: ResolvedPair,
  tx: TxResponse,
  txnIndex: number,
): Promise<IndexedEvent[]> {
  if (tx.code && tx.code !== 0) return [];
  const height = Number(tx.height);
  const items = collectWasmSections(tx);
  const sections = items.map((i) => i.section);
  const events: IndexedEvent[] = [];

  for (const item of items) {
    const { section, eventIndex } = item;
    if (section._contract_address !== pair.pair.id) continue;
    const action = (section.action || "").toLowerCase();

    if (action === "swap") {
      const { r0Raw, r1Raw } = await reservesForSwap(
        pair,
        section,
        sections,
        height,
      );
      const ev = buildSwapEvent({
        pair,
        section,
        tx,
        txnIndex,
        eventIndex,
        r0Raw,
        r1Raw,
      });
      if (ev) events.push(ev);
      continue;
    }

    if (JOIN_ACTIONS.has(action) || EXIT_ACTIONS.has(action)) {
      let r0Raw = section.reserve0;
      let r1Raw = section.reserve1;
      if (!r0Raw || !r1Raw) {
        try {
          const r = await getPoolReserves(pair.pair.id, height);
          r0Raw = r.reserve0;
          r1Raw = r.reserve1;
        } catch {
          const r = await getPoolReserves(pair.pair.id);
          r0Raw = r.reserve0;
          r1Raw = r.reserve1;
        }
      }
      const ev = buildJoinExit({
        pair,
        section,
        tx,
        txnIndex,
        eventIndex,
        eventType: JOIN_ACTIONS.has(action) ? "join" : "exit",
        r0Raw,
        r1Raw,
      });
      if (ev) events.push(ev);
    }
  }

  return events;
}

export async function getEvents(
  fromBlock: number,
  toBlock: number,
): Promise<IndexedEvent[]> {
  if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) {
    throw Object.assign(new Error("fromBlock and toBlock are required"), {
      status: 400,
    });
  }
  if (fromBlock > toBlock) {
    throw Object.assign(new Error("fromBlock must be <= toBlock"), {
      status: 400,
    });
  }
  const span = toBlock - fromBlock;
  if (span > MAX_EVENTS_BLOCK_SPAN) {
    throw Object.assign(
      new Error(
        `Block span ${span} exceeds MAX_EVENTS_BLOCK_SPAN=${MAX_EVENTS_BLOCK_SPAN}`,
      ),
      { status: 400 },
    );
  }

  const pairs = await listPairs();
  const all: IndexedEvent[] = [];

  await Promise.all(
    pairs.map(async (pair) => {
      let txs: TxResponse[] = [];
      try {
        txs = await searchTxsByContractAndHeight(
          pair.pair.id,
          fromBlock,
          toBlock,
          100,
        );
      } catch (e) {
        console.warn(
          `[events] LCD search failed for ${pair.pair.id}:`,
          (e as Error).message,
        );
        return;
      }

      txs.sort((a, b) => {
        const ha = Number(a.height);
        const hb = Number(b.height);
        if (ha !== hb) return ha - hb;
        return (a.txhash || "").localeCompare(b.txhash || "");
      });

      const perBlock = new Map<number, number>();
      for (const tx of txs) {
        const h = Number(tx.height);
        if (h < fromBlock || h > toBlock) continue;
        const txnIndex = perBlock.get(h) ?? 0;
        perBlock.set(h, txnIndex + 1);
        const evs = await parseTxForPair(pair, tx, txnIndex);
        all.push(...evs);
      }
    }),
  );

  all.sort((a, b) => {
    if (a.block.blockNumber !== b.block.blockNumber) {
      return a.block.blockNumber - b.block.blockNumber;
    }
    if (a.txnIndex !== b.txnIndex) return a.txnIndex - b.txnIndex;
    return a.eventIndex - b.eventIndex;
  });

  return all;
}

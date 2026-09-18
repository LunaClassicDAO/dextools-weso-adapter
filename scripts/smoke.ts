/**
 * Smoke test against a running DexTools adapter (default http://127.0.0.1:8080).
 */
const BASE = (process.env.ADAPTER_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);

const FACTORY =
  "terra1veqa6znu8lfdmz9kp9v047chfmn84q5k3pacme75gl8ywmplk92q6xnq2k";
const WESO =
  "terra13ryrrlcskwa05cd94h54c8rnztff9l82pp0zqnfvlwt77za8wjjsld36ms";
const REBASE = "terra1uewxz67jhhhs2tj97pfm2egtk7zqxuhenm4y4m";
const CWLUNC =
  "terra10fusc7487y4ju2v5uavkauf3jdpxx9h8sc7wsqdqg4rne8t4qyrq8385q6";

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Smoke testing", BASE);

  const health = await get("/health");
  assert(health.status === 200, `/health status ${health.status}`);
  const h = health.body as any;
  assert(h.pairCount >= 3, `pairCount expected >=3, got ${h.pairCount}`);
  assert(
    h.bondingCurvePairCount === 2,
    `bondingCurvePairCount expected 2, got ${h.bondingCurvePairCount}`,
  );
  console.log(
    "✓ /health",
    h.pairCount,
    "pairs (",
    h.ammPairCount,
    "AMM +",
    h.bondingCurvePairCount,
    "curves)",
  );

  const latest = await get("/latest-block");
  assert(latest.status === 200, `/latest-block status ${latest.status}`);
  const block = (latest.body as any).block;
  assert(block?.blockNumber > 0, "blockNumber missing");
  assert(block?.blockTimestamp > 0, "blockTimestamp missing");
  console.log("✓ /latest-block", block.blockNumber, block.blockTimestamp);

  const byNum = await get(`/block?number=${block.blockNumber}`);
  assert(byNum.status === 200, `/block?number status ${byNum.status}`);
  assert(
    (byNum.body as any).block?.blockNumber === block.blockNumber,
    "block number match",
  );
  console.log("✓ /block?number=");

  const asset = await get("/asset?id=uluna");
  assert(asset.status === 200, `/asset uluna status ${asset.status}`);
  const a = (asset.body as any).asset;
  assert(a?.id === "uluna", "uluna id");
  assert(a?.symbol === "LUNC", "uluna symbol");
  assert(a?.decimals === undefined, "decimals must not leak in DexTools Asset");
  console.log("✓ /asset?id=uluna", a.symbol);

  for (const [id, symbol] of [
    [WESO, "WESO"],
    [REBASE, "reBASE"],
  ] as const) {
    const r = await get(`/asset?id=${encodeURIComponent(id)}`);
    assert(r.status === 200, `/asset ${symbol} status ${r.status}`);
    const as = (r.body as any).asset;
    assert(as?.symbol === symbol, `${symbol} symbol got ${as?.symbol}`);
    console.log("✓ /asset", symbol);
  }

  const holders = await get(`/asset/holders?id=uluna&page=1&pageSize=10`);
  assert(holders.status === 200, `/asset/holders status ${holders.status}`);
  const ha = (holders.body as any).asset;
  assert(ha?.id === "uluna", "holders id");
  assert(Array.isArray(ha?.holders), "holders array");
  assert(ha.holders.length === 0, "stub holders empty");
  console.log("✓ /asset/holders stub");

  const ex = await get(`/exchange?id=${encodeURIComponent(FACTORY)}`);
  assert(ex.status === 200, `/exchange status ${ex.status}`);
  assert((ex.body as any).exchange?.name === "WESO DeFi", "exchange name");
  console.log("✓ /exchange");

  const pairs = await get("/pairs");
  assert(pairs.status === 200, `/pairs status ${pairs.status}`);
  const list = (pairs.body as any).pairs || [];
  const ids = new Set(list.map((p: any) => p.id));
  assert(ids.has(WESO) && ids.has(REBASE), "curves in /pairs");
  assert(list.every((p: any) => p.factoryAddress === FACTORY), "factoryAddress");
  console.log(
    "✓ /pairs",
    list.length,
    list.map((p: any) => p.displayName).join(", "),
  );

  for (const id of [WESO, REBASE]) {
    const pair = await get(`/pair?id=${encodeURIComponent(id)}`);
    assert(pair.status === 200, `/pair ${id.slice(0, 12)} status ${pair.status}`);
    const p = (pair.body as any).pair;
    assert(p.factoryAddress === FACTORY, "pair factoryAddress");
    assert(typeof p.createdAtBlockNumber === "number", "createdAtBlockNumber");
    assert(typeof p.createdAtTxnId === "string", "createdAtTxnId");
    console.log("✓ /pair", id.slice(0, 16) + "…");
  }

  const wrap = await get(`/pair?id=${encodeURIComponent(CWLUNC)}`);
  assert(wrap.status === 404, `wrap vault as pair should 404, got ${wrap.status}`);
  console.log("✓ wrap vault /pair 404");

  const to = block.blockNumber;
  const from = Math.max(1, to - 50);
  const events = await get(`/events?fromBlock=${from}&toBlock=${to}`);
  assert(events.status === 200, `/events status ${events.status}`);
  assert(Array.isArray((events.body as any).events), "events array");
  console.log(`✓ /events ${from}-${to} → ${(events.body as any).events.length}`);

  const juris =
    "terra14jedagazgdawpjfn37yhec5lfxs5fh22r6cl3uspa4x9yt8hnhlsp322v7";
  const hist = await get(`/events?fromBlock=30442580&toBlock=30442730`);
  if (hist.status === 200) {
    const he = (hist.body as any).events as any[];
    const swaps = he.filter(
      (e) => e.eventType === "swap" && e.pairId === juris,
    );
    console.log(`✓ historical JURIS window swaps: ${swaps.length}`);
    for (const s of swaps.slice(0, 3)) {
      assert(s.reserves?.asset0 && s.reserves?.asset1, "reserves present");
      const sides =
        (s.asset0In != null && s.asset1Out != null) ||
        (s.asset1In != null && s.asset0Out != null);
      assert(sides, "swap sides");
    }
  } else {
    console.warn("⚠ historical JURIS window unavailable", hist.status);
  }

  const docs = await get("/docs/ADAPTER.md");
  assert(docs.status === 200, `/docs/ADAPTER.md status ${docs.status}`);
  assert(typeof docs.body === "string", "docs body string");
  const docText = docs.body as string;
  assert(
    docText.includes("DexTools") || docText.includes("dextools"),
    "docs mention DexTools",
  );
  assert(
    docText.includes("vercel.app") || docText.includes("FACTORY") || docText.includes("Factory"),
    "docs mention hosting or contracts",
  );
  console.log("✓ /docs/ADAPTER.md", docText.slice(0, 60).replace(/\n/g, " "), "…");

  console.log("\nSmoke OK");
}

main().catch((e) => {
  console.error("Smoke FAILED", e);
  process.exit(1);
});

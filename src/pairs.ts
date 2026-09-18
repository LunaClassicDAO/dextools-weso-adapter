import {
  BONDING_CURVES,
  BONDING_CURVE_IDS,
  EXCLUDED_PAIR_TYPES,
  FACTORY,
  PAIR_CACHE_TTL_MS,
} from "./config.js";
import { querySmart } from "./lcd.js";
import { getAsset } from "./assets.js";
import type { FactoryPair, Pair, PoolAsset } from "./types.js";
import { assetIdFromInfo, pairTypeKey } from "./utils.js";

interface PairCache {
  at: number;
  byId: Map<string, ResolvedPair>;
  list: ResolvedPair[];
}

export interface ResolvedPair {
  factory?: FactoryPair;
  pair: Pair;
  asset0Decimals: number;
  asset1Decimals: number;
  pairType: string;
  bondingCurve?: boolean;
  /** Display name for /pairs convenience + docs (not in DexTools Pair schema). */
  displayName: string;
}

let cache: PairCache | null = null;

async function loadBondingCurvePairs(): Promise<ResolvedPair[]> {
  const out: ResolvedPair[] = [];
  for (const def of BONDING_CURVES) {
    const asset0Id = def.reserveDenom;
    const asset1Id = def.id;
    const a0 = await getAsset(asset0Id);
    const a1 = await getAsset(asset1Id);
    const tokenSymbol = a1.symbol || def.symbol;
    const nativeSymbol = a0.symbol;
    const displayName = `${nativeSymbol}/${tokenSymbol}`;

    const pair: Pair = {
      id: def.id,
      asset0Id,
      asset1Id,
      // Product curves launched with the DEX; exact create tx not required for indexing.
      createdAtBlockNumber: 0,
      createdAtBlockTimestamp: 0,
      createdAtTxnId: "0",
      factoryAddress: FACTORY,
    };

    out.push({
      pair,
      asset0Decimals: a0.decimals,
      asset1Decimals: a1.decimals,
      pairType: "cw20_bonding",
      bondingCurve: true,
      displayName,
    });
  }
  return out;
}

async function loadPairs(force = false): Promise<PairCache> {
  if (
    !force &&
    cache &&
    Date.now() - cache.at < PAIR_CACHE_TTL_MS &&
    cache.list.length
  ) {
    return cache;
  }

  const all: FactoryPair[] = [];
  let page: FactoryPair[];
  do {
    const query: { pairs: { limit: number; start_after?: unknown } } = {
      pairs: { limit: 30 },
    };
    if (all.length) {
      query.pairs.start_after = all[all.length - 1].asset_infos;
    }
    const { pairs } = await querySmart<{ pairs: FactoryPair[] }>(FACTORY, query);
    if (!Array.isArray(pairs)) {
      throw new Error("WESO factory returned a malformed pairs response");
    }
    page = pairs;
    all.push(...page);
  } while (page.length > 0);

  const included = all.filter(
    (p) => !EXCLUDED_PAIR_TYPES.has(pairTypeKey(p.pair_type)),
  );

  const byId = new Map<string, ResolvedPair>();
  const list: ResolvedPair[] = [];

  for (const fp of included) {
    const asset0Id = assetIdFromInfo(fp.asset_infos?.[0]);
    const asset1Id = assetIdFromInfo(fp.asset_infos?.[1]);
    if (!asset0Id || !asset1Id || !fp.contract_addr) continue;

    let d0 = fp.asset_decimals?.[0];
    let d1 = fp.asset_decimals?.[1];
    const a0 = await getAsset(asset0Id);
    const a1 = await getAsset(asset1Id);
    if (d0 == null) d0 = a0.decimals;
    if (d1 == null) d1 = a1.decimals;

    const pairType = pairTypeKey(fp.pair_type) || "amm";
    const pair: Pair = {
      id: fp.contract_addr,
      asset0Id,
      asset1Id,
      createdAtBlockNumber: 0,
      createdAtBlockTimestamp: 0,
      createdAtTxnId: "0",
      factoryAddress: FACTORY,
    };

    const resolved: ResolvedPair = {
      factory: fp,
      pair,
      asset0Decimals: d0,
      asset1Decimals: d1,
      pairType,
      displayName: `${a0.symbol}/${a1.symbol}`,
    };
    byId.set(fp.contract_addr, resolved);
    list.push(resolved);
  }

  for (const curve of await loadBondingCurvePairs()) {
    byId.set(curve.pair.id, curve);
    list.push(curve);
  }

  cache = { at: Date.now(), byId, list };
  return cache;
}

export async function listPairs(): Promise<ResolvedPair[]> {
  return (await loadPairs()).list;
}

export async function getPair(id: string): Promise<ResolvedPair> {
  const c = await loadPairs();
  const hit = c.byId.get(id);
  if (!hit) {
    throw Object.assign(
      new Error(
        BONDING_CURVE_IDS.has(id)
          ? `Unknown pair: ${id}`
          : `Unknown or excluded pair: ${id}`,
      ),
      { status: 404 },
    );
  }
  return hit;
}

export interface CurveInfo {
  reserve: string;
  supply: string;
  spot_price?: string;
  reserve_denom?: string;
  tax_collected?: string;
}

export async function getCurveReserves(
  curveId: string,
  height?: number,
): Promise<{ reserve0: string; reserve1: string }> {
  const info = await querySmart<CurveInfo>(curveId, { curve_info: {} }, height);
  return {
    reserve0: info.reserve || "0",
    reserve1: info.supply || "0",
  };
}

export async function getPoolReserves(
  pairId: string,
  height?: number,
): Promise<{ reserve0: string; reserve1: string }> {
  const resolved = await getPair(pairId);

  if (resolved.bondingCurve || BONDING_CURVE_IDS.has(pairId)) {
    return getCurveReserves(pairId, height);
  }

  const pool = await querySmart<{ assets: PoolAsset[] }>(
    pairId,
    { pool: {} },
    height,
  );
  const assets = pool.assets || [];
  const amounts = new Map<string, string>();
  for (const a of assets) {
    const id = assetIdFromInfo(a.info);
    if (id) amounts.set(id, a.amount || "0");
  }
  return {
    reserve0: amounts.get(resolved.pair.asset0Id) || "0",
    reserve1: amounts.get(resolved.pair.asset1Id) || "0",
  };
}

export function invalidatePairCache(): void {
  cache = null;
}

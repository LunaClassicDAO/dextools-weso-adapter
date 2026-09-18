import {
  ASSET_CACHE_TTL_MS,
  ASSET_OVERRIDES,
  BONDING_CURVE_IDS,
  NATIVE_ASSETS,
} from "./config.js";
import { querySmart } from "./lcd.js";
import type { Asset } from "./types.js";
import { decimalize } from "./utils.js";

type CacheEntry = { at: number; asset: Asset };
const cache = new Map<string, CacheEntry>();

export async function getAsset(id: string): Promise<Asset> {
  const key = id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ASSET_CACHE_TTL_MS) return hit.asset;

  const override = ASSET_OVERRIDES[id];
  const native = NATIVE_ASSETS[id];

  if (native) {
    const asset: Asset = {
      id,
      name: native.name,
      symbol: native.symbol,
      decimals: native.decimals,
    };
    cache.set(key, { at: Date.now(), asset });
    return asset;
  }

  if (override) {
    let totalSupply: string | undefined;
    let name = override.name;
    let symbol = override.symbol;
    let decimals = override.decimals;
    try {
      const info = await querySmart<{
        name: string;
        symbol: string;
        decimals: number;
        total_supply: string;
      }>(id, { token_info: {} });
      if (BONDING_CURVE_IDS.has(id)) {
        if (info?.name) name = info.name;
        if (info?.symbol) symbol = info.symbol;
        if (info?.decimals != null && Number.isFinite(Number(info.decimals))) {
          decimals = Number(info.decimals);
        }
      }
      if (info?.total_supply) {
        totalSupply = decimalize(info.total_supply, decimals);
      }
    } catch {
      /* optional */
    }
    const asset: Asset = {
      id,
      name,
      symbol,
      decimals,
      ...(totalSupply ? { totalSupply, circulatingSupply: totalSupply } : {}),
    };
    cache.set(key, { at: Date.now(), asset });
    return asset;
  }

  if (!id.startsWith("terra1") && !id.startsWith("ibc/")) {
    throw Object.assign(new Error(`Unknown asset id: ${id}`), { status: 404 });
  }

  if (id.startsWith("ibc/")) {
    const asset: Asset = {
      id,
      name: id.slice(0, 16) + "…",
      symbol: "IBC",
      decimals: 6,
    };
    cache.set(key, { at: Date.now(), asset });
    return asset;
  }

  const info = await querySmart<{
    name: string;
    symbol: string;
    decimals: number;
    total_supply: string;
  }>(id, { token_info: {} });

  const decimals = Number(info.decimals);
  const d = Number.isFinite(decimals) ? decimals : 6;
  const totalSupply = info.total_supply
    ? decimalize(info.total_supply, d)
    : undefined;
  const asset: Asset = {
    id,
    name: info.name || info.symbol || id,
    symbol: info.symbol || "UNKNOWN",
    decimals: d,
    ...(totalSupply ? { totalSupply, circulatingSupply: totalSupply } : {}),
  };
  cache.set(key, { at: Date.now(), asset });
  return asset;
}

/** Strip internal-only fields for DexTools Asset response. */
export function toDexToolsAsset(asset: Asset): Omit<Asset, "decimals"> & {
  decimals?: never;
} {
  const { decimals: _d, ...rest } = asset;
  return rest;
}

export function peekAssetDecimals(id: string, fallback = 6): number {
  const hit = cache.get(id);
  if (hit) return hit.asset.decimals;
  if (NATIVE_ASSETS[id]) return NATIVE_ASSETS[id].decimals;
  if (ASSET_OVERRIDES[id]) return ASSET_OVERRIDES[id].decimals;
  return fallback;
}

// silence unused import warnings for wrap constants used only for docs/cache kinds

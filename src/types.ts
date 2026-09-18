export type AssetInfo =
  | { native_token: { denom: string } }
  | { token: { contract_addr: string } };

export interface FactoryPair {
  asset_infos: AssetInfo[];
  contract_addr: string;
  liquidity_token?: string;
  asset_decimals?: number[];
  pair_type?: unknown;
}

export interface PoolAsset {
  info: AssetInfo;
  amount: string;
}

/** DexTools Block schema */
export interface Block {
  blockNumber: number;
  blockTimestamp: number;
}

/** DexTools Asset schema (+ internal decimals for amount math) */
export interface Asset {
  id: string;
  name: string;
  symbol: string;
  totalSupply?: string;
  circulatingSupply?: string;
  holdersCount?: number;
  /** Internal only — stripped before HTTP response */
  decimals: number;
}

/** DexTools Pair schema */
export interface Pair {
  id: string;
  asset0Id: string;
  asset1Id: string;
  createdAtBlockNumber: number;
  createdAtBlockTimestamp: number;
  createdAtTxnId: string;
  factoryAddress: string;
}

export interface SwapEvent {
  eventType: "swap";
  txnId: string;
  txnIndex: number;
  eventIndex: number;
  maker: string;
  pairId: string;
  asset0In?: string;
  asset1In?: string;
  asset0Out?: string;
  asset1Out?: string;
  reserves: { asset0: string; asset1: string };
}

export interface JoinExitEvent {
  eventType: "join" | "exit";
  txnId: string;
  txnIndex: number;
  eventIndex: number;
  maker: string;
  pairId: string;
  amount0: string;
  amount1: string;
  reserves: { asset0: string; asset1: string };
}

export interface CreationEvent {
  eventType: "creation";
  txnId: string;
  txnIndex: number;
  eventIndex: number;
  maker: string;
  pairId: string;
}

export type IndexedEvent = { block: Block } & (
  | SwapEvent
  | JoinExitEvent
  | CreationEvent
);

/** DexTools Exchange schema */
export interface Exchange {
  factoryAddress: string;
  name: string;
  logoURL?: string;
}

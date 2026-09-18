# WESO DeFi — DexTools HTTP Adapter
### DEX-level integration — Terra Classic (columbus-5)

**DEX / product:** WESO DeFi  
**Website:** https://weso.world  
**Chain:** Terra Classic (`columbus-5`)  
**Integration level:** **DEX-level** (single URL for WESO only; `/exchange` also implemented)

This document describes the DexTools [http-adapter](https://github.com/dextools-io/integration-sdk) HTTP API used to index WESO DeFi: **factory AMM** pools **and** product **cw20 bonding curves** ($WESO, $reBASE).

---

## 1. Contracts

| Role | Address |
| --- | --- |
| AMM Factory | `terra1veqa6znu8lfdmz9kp9v047chfmn84q5k3pacme75gl8ywmplk92q6xnq2k` |
| AMM Router | `terra1nynrxdccq0r9ghrz0sq7tjkkh8wug0ggg4lkzsags8r9dyhf7ypqx5gsr8` |
| $WESO bonding curve (CW20 vs LUNC) | `terra13ryrrlcskwa05cd94h54c8rnztff9l82pp0zqnfvlwt77za8wjjsld36ms` |
| $reBASE bonding curve (CW20 vs USTC) | `terra1uewxz67jhhhs2tj97pfm2egtk7zqxuhenm4y4m` |

### Included pairs

**Factory AMM** (aligned with DeFiLlama AMM volume methodology):

- `reflective`
- `cumulative`

**Product bonding curves** (first-class pairs):

| Pair id (= curve contract) | asset0Id | asset1Id | display |
| --- | --- | --- | --- |
| $WESO curve | `uluna` | WESO contract | `LUNC/WESO` |
| $reBASE curve | `uusd` | reBASE contract | `USTC/reBASE` |

### Excluded (not DEX product pairs)

- `token_bonding` — native ↔ CW20 **wrap vaults** (LUNC↔CWLUNC, USTC↔CWUSTC). Not the $WESO / $reBASE product curves.
- `converter`

Wrap vault contracts **404** when used as `/pair?id=`.

### Deferred (Phase 2)

- Forex CLOB taker fills

---

## 2. Base URL

```
https://weso-dt-api.vercel.app
```

All paths below are relative to that API base (e.g. `GET https://weso-dt-api.vercel.app/latest-block`).

**Stable docs URLs:**
- Hosted: `https://weso-dt-api.vercel.app/docs/ADAPTER.md`
- GitHub raw: `https://raw.githubusercontent.com/LunaClassicDAO/dextools-weso-adapter/main/docs/ADAPTER.md`

**Not used for listing:** weso.world, wesoenergy.com (product site only at https://weso.world).

---

## 3. Endpoints (DexTools OpenAPI)

### 3.1 `GET /latest-block`

Returns the latest Terra Classic block the adapter can serve via `/events`.

```json
{
  "block": {
    "blockNumber": 30447625,
    "blockTimestamp": 1726617120
  }
}
```

`blockTimestamp` is Unix **seconds**.

### 3.2 `GET /block?number={n}` | `GET /block?timestamp={unixSeconds}`

- `number` takes precedence if both are set.
- `timestamp`: youngest block with `blockTimestamp <=` requested (required mainly for sharded chains; implemented for completeness).
- Missing both params → `400`.

### 3.3 `GET /asset?id={assetId}`

| Kind | `id` | Example |
| --- | --- | --- |
| Native LUNC | `uluna` | Luna Classic / LUNC |
| Native USTC | `uusd` | TerraClassicUSD / USTC |
| CW20 | contract address | CWLUNC, CWUSTC, WESO, reBASE |

Response follows DexTools `Asset` schema (`id`, `name`, `symbol`, optional `totalSupply` / `circulatingSupply`). Amounts in events are **decimalized** (`raw / 10^decimals`, typically 6).

### 3.4 `GET /asset/holders?id={id}&page=&pageSize=`

Stub: returns `{ totalHoldersCount: 0, holders: [] }` after validating the asset exists. Public Terra Classic LCD does not expose a reliable CW20 holder index.

### 3.5 `GET /exchange?id={factoryAddress}`

Optional for DEX-level; implemented. Accepts the WESO factory address only.

```json
{
  "exchange": {
    "factoryAddress": "terra1veqa6znu8lfdmz9kp9v047chfmn84q5k3pacme75gl8ywmplk92q6xnq2k",
    "name": "WESO DeFi",
    "logoURL": "https://raw.githubusercontent.com/LunaClassicDAO/dextools-weso-adapter/main/assets/weso-defi-logo-round.png"
  }
}
```

### 3.6 `GET /pair?id={pairId}`

`pairId` is a factory AMM pair contract **or** a product bonding-curve contract.

DexTools fields: `id`, `asset0Id`, `asset1Id`, `createdAtBlockNumber`, `createdAtBlockTimestamp`, `createdAtTxnId`, `factoryAddress` (always the WESO factory).

Curves: `asset0Id` = reserve denom (`uluna` / `uusd`); `asset1Id` = CW20 curve contract (= pair id).

### 3.7 `GET /events?fromBlock={n}&toBlock={n}`

Inclusive height range. Emits `swap` / `join` / `exit` for included AMM pairs and both product curves.

**Swap mapping** (same as DeFiLlama / GeckoTerminal WESO adapters):

| On-chain | DexTools fields |
| --- | --- |
| Buy (native → CW20 mint) | `asset0In` + `asset1Out` |
| Sell/burn (CW20 → native) | `asset1In` + `asset0Out` |

Wasm: `action=swap` with `offer_asset` / `ask_asset` / `offer_amount` / `return_amount`. Non-swap transfers excluded.

**Reserves:** event attrs when present; else AMM `pool` query or curve `curve_info.reserve` / `supply`.

Event discovery: LCD  
`tx.height>=from AND tx.height<=to AND wasm._contract_address='<pair|curve>'`.

---

## 4. Alignment with DeFiLlama / GeckoTerminal

| Volume source | In this DexTools adapter? |
| --- | --- |
| Factory AMM (`reflective` / `cumulative`) | **Yes** |
| $WESO bonding-curve LUNC volume | **Yes** |
| $reBASE bonding-curve USTC volume | **Yes** |
| Forex CLOB | Phase 2 / deferred |
| Wrap/unwrap & converter | **Excluded** |

Verified contracts match DefiLlama WESO + `LunaClassicDAO/geckoterminal-weso-adapter`.

---

## 5. Operational notes for DexTools indexer

- Prefer **DEX-level** base URL above (WESO only).
- Poll `/latest-block`, then `/events?fromBlock&toBlock` in chunks (≤ 500–2000 blocks).
- Upstream LCD: `https://terra-classic-lcd.publicnode.com` (configurable).
- Error bodies use DexTools `{ code, message, issues[] }` shape.

---

## 6. Contact

- Email: dao@lunaclassicdao.com  
- X: @daolunaclassic  
- Telegram: https://t.me/ClassicDAO  
- Website: https://weso.world  
- Logo: https://raw.githubusercontent.com/LunaClassicDAO/dextools-weso-adapter/main/assets/weso-defi-logo-round.png  

---

*Document version: 1.0 — DexTools DEX-level adapter for WESO DeFi on Terra Classic.*

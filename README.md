# WESO DeFi — DexTools Adapter API (Terra Classic)

HTTP API implementing the [DexTools http-adapter](https://github.com/dextools-io/integration-sdk) OpenAPI for **WESO DeFi** on **Terra Classic (columbus-5)**.

**Integration:** DEX-level (single URL for WESO only).  
**Scope (v1):** factory AMM (`reflective` / `cumulative`) **+** product bonding curves (`$WESO`, `$reBASE`). Wrap vaults and forex CLOB are out of scope.

Public write-up for the DexTools community request: [`docs/ADAPTER.md`](./docs/ADAPTER.md).

## Contracts

| Role | Address |
| --- | --- |
| Factory | `terra1veqa6znu8lfdmz9kp9v047chfmn84q5k3pacme75gl8ywmplk92q6xnq2k` |
| Router | `terra1nynrxdccq0r9ghrz0sq7tjkkh8wug0ggg4lkzsags8r9dyhf7ypqx5gsr8` |
| $WESO curve | `terra13ryrrlcskwa05cd94h54c8rnztff9l82pp0zqnfvlwt77za8wjjsld36ms` |
| $reBASE curve | `terra1uewxz67jhhhs2tj97pfm2egtk7zqxuhenm4y4m` |

## Run locally

```bash
npm install
npm start
# listens on :8080 by default
ADAPTER_URL=http://127.0.0.1:8080 npm run smoke
```

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/latest-block` | Tip block |
| GET | `/block` | `?number=` or `?timestamp=` |
| GET | `/asset` | `?id=` |
| GET | `/asset/holders` | Stub empty page |
| GET | `/exchange` | WESO factory id |
| GET | `/pair` | `?id=` |
| GET | `/events` | `?fromBlock=&toBlock=` |
| GET | `/pairs` | Convenience list (not in OpenAPI) |
| GET | `/health` | Ops |
| GET | `/docs/ADAPTER.md` | This adapter doc |

## Production

- API: `https://weso-dextools-adapter.vercel.app`
- Repo: https://github.com/LunaClassicDAO/dextools-weso-adapter

Do **not** host on weso.world / wesoenergy.com.

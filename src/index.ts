import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import {
  BONDING_CURVES,
  FACTORY,
  LCD_URL,
  MAX_EVENTS_BLOCK_SPAN,
  PORT,
  ROUTER,
} from "./config.js";
import {
  getLatestBlock,
  getBlockByNumber,
  getBlockByTimestamp,
} from "./lcd.js";
import { getAsset, toDexToolsAsset } from "./assets.js";
import { getPair, listPairs } from "./pairs.js";
import { getEvents } from "./events.js";
import { badRequest, internal, notFound } from "./errors.js";

const LOGO_URL =
  "https://raw.githubusercontent.com/LunaClassicDAO/dextools-weso-adapter/main/assets/weso-defi-logo-round.png";

const app = express();
app.use(cors());
app.use(express.json());

function resolveAdapterDoc(): string | null {
  const candidates = [
    path.join(process.cwd(), "docs", "ADAPTER.md"),
    path.join(process.cwd(), "ADAPTER.md"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

app.get("/health", async (_req, res) => {
  try {
    const block = await getLatestBlock();
    const pairs = await listPairs();
    const ammCount = pairs.filter((p) => !p.bondingCurve).length;
    const curveCount = pairs.filter((p) => p.bondingCurve).length;
    res.json({
      ok: true,
      integration: "dextools-dex-level",
      name: "WESO DeFi",
      chain: "Terra Classic (columbus-5)",
      factory: FACTORY,
      router: ROUTER,
      lcd: LCD_URL,
      pairCount: pairs.length,
      ammPairCount: ammCount,
      bondingCurvePairCount: curveCount,
      latestBlock: block,
    });
  } catch (e) {
    res.status(503).json(internal((e as Error).message));
  }
});

app.get("/latest-block", async (_req, res) => {
  try {
    const { blockNumber, blockTimestamp } = await getLatestBlock();
    res.json({ block: { blockNumber, blockTimestamp } });
  } catch (e) {
    res.status(500).json(internal((e as Error).message));
  }
});

app.get("/block", async (req, res) => {
  try {
    const numberRaw = req.query.number;
    const timestampRaw = req.query.timestamp;
    if (numberRaw == null && timestampRaw == null) {
      res
        .status(400)
        .json(
          badRequest(
            "Provide query param number or timestamp",
            numberRaw == null ? "number" : "timestamp",
          ),
        );
      return;
    }
    if (numberRaw != null && String(numberRaw) !== "") {
      const n = Number(numberRaw);
      if (!Number.isFinite(n) || n < 1) {
        res.status(400).json(badRequest("number must be a positive integer", "number"));
        return;
      }
      const block = await getBlockByNumber(Math.floor(n));
      res.json({ block });
      return;
    }
    const ts = Number(timestampRaw);
    if (!Number.isFinite(ts) || ts <= 0) {
      res
        .status(400)
        .json(badRequest("timestamp must be a positive unix seconds value", "timestamp"));
      return;
    }
    const block = await getBlockByTimestamp(Math.floor(ts));
    res.json({ block });
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 404) {
      res.status(404).json(notFound(err.message, "block"));
      return;
    }
    if (err.status === 400) {
      res.status(400).json(badRequest(err.message));
      return;
    }
    res.status(500).json(internal(err.message));
  }
});

app.get("/asset", async (req, res) => {
  try {
    const id = String(req.query.id || "");
    if (!id) {
      res.status(400).json(badRequest("Query param id is required", "id"));
      return;
    }
    const asset = await getAsset(id);
    res.json({ asset: toDexToolsAsset(asset) });
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 404) {
      res.status(404).json(notFound(err.message, "id"));
      return;
    }
    res.status(500).json(internal(err.message));
  }
});

/** Stub: Terra Classic CW20 holder index not available via public LCD. */
app.get("/asset/holders", async (req, res) => {
  try {
    const id = String(req.query.id || "");
    if (!id) {
      res.status(400).json(badRequest("Query param id is required", "id"));
      return;
    }
    // Validate asset exists
    await getAsset(id);
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 10);
    if (!Number.isFinite(page) || page < 1) {
      res.status(400).json(badRequest("page must be >= 1", "page"));
      return;
    }
    if (!Number.isFinite(pageSize) || pageSize < 1) {
      res.status(400).json(badRequest("pageSize must be >= 1", "pageSize"));
      return;
    }
    res.json({
      asset: {
        id,
        totalHoldersCount: 0,
        holders: [],
      },
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 404) {
      res.status(404).json(notFound(err.message, "id"));
      return;
    }
    res.status(500).json(internal(err.message));
  }
});

app.get("/exchange", async (req, res) => {
  try {
    const id = String(req.query.id || "");
    if (!id) {
      res.status(400).json(badRequest("Query param id is required", "id"));
      return;
    }
    if (id !== FACTORY) {
      res.status(404).json(notFound(`Unknown exchange id: ${id}`, "id"));
      return;
    }
    res.json({
      exchange: {
        factoryAddress: FACTORY,
        name: "WESO DeFi",
        logoURL: LOGO_URL,
      },
    });
  } catch (e) {
    res.status(500).json(internal((e as Error).message));
  }
});

app.get("/pair", async (req, res) => {
  try {
    const id = String(req.query.id || "");
    if (!id) {
      res.status(400).json(badRequest("Query param id is required", "id"));
      return;
    }
    const resolved = await getPair(id);
    res.json({ pair: resolved.pair });
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 404) {
      res.status(404).json(notFound(err.message, "id"));
      return;
    }
    res.status(500).json(internal(err.message));
  }
});

/** Convenience: list included AMM + bonding-curve pairs (not required by DexTools). */
app.get("/pairs", async (_req, res) => {
  try {
    const list = await listPairs();
    res.json({
      pairs: list.map((p) => ({
        ...p.pair,
        displayName: p.displayName,
        pairType: p.pairType,
        bondingCurve: !!p.bondingCurve,
      })),
      excludedPairTypes: ["token_bonding", "converter"],
      bondingCurves: BONDING_CURVES.map((c) => c.id),
      note: "token_bonding factory types are wrap vaults (excluded); product curves $WESO/$reBASE are included",
    });
  } catch (e) {
    res.status(500).json(internal((e as Error).message));
  }
});

app.get("/events", async (req, res) => {
  try {
    const fromBlock = Number(req.query.fromBlock);
    const toBlock = Number(req.query.toBlock);
    if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) {
      res
        .status(400)
        .json(
          badRequest(
            "fromBlock and toBlock query params are required numbers",
            "fromBlock",
          ),
        );
      return;
    }
    const events = await getEvents(fromBlock, toBlock);
    res.json({ events });
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 400) {
      res.status(400).json(badRequest(err.message));
      return;
    }
    res.status(500).json({
      ...internal(err.message),
      // extra hint for operators
      maxBlockSpan: MAX_EVENTS_BLOCK_SPAN,
    });
  }
});

app.get(["/docs/ADAPTER.md", "/docs/adapter.md"], async (_req, res) => {
  const docPath = resolveAdapterDoc();
  if (docPath) {
    res.type("text/markdown; charset=utf-8").send(fs.readFileSync(docPath, "utf8"));
    return;
  }
  // Fallback: GitHub raw (Vercel function may omit docs/ includeFiles)
  try {
    const url =
      "https://raw.githubusercontent.com/LunaClassicDAO/dextools-weso-adapter/main/docs/ADAPTER.md";
    const r = await fetch(url);
    if (!r.ok) throw new Error(`docs fetch ${r.status}`);
    const md = await r.text();
    res.type("text/markdown; charset=utf-8").send(md);
  } catch (e) {
    res.status(404).type("text/plain").send("ADAPTER.md not found in deployment");
  }
});

app.get("/", (_req, res) => {
  res.json({
    name: "WESO DeFi DexTools Adapter API",
    integration: "DEX-level",
    chain: "Terra Classic (columbus-5)",
    factory: FACTORY,
    router: ROUTER,
    bondingCurves: BONDING_CURVES.map((c) => ({
      id: c.id,
      reserveDenom: c.reserveDenom,
      symbol: c.symbol,
    })),
    endpoints: [
      "GET /health",
      "GET /latest-block",
      "GET /block?number= | /block?timestamp=",
      "GET /asset?id=",
      "GET /asset/holders?id=&page=&pageSize=",
      "GET /exchange?id=",
      "GET /pair?id=",
      "GET /pairs",
      "GET /events?fromBlock=&toBlock=",
      "GET /docs/ADAPTER.md",
    ],
    docs: "/docs/ADAPTER.md",
    spec: "https://github.com/dextools-io/integration-sdk (http-adapter)",
  });
});

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(
      `WESO DexTools adapter listening on :${PORT} (factory=${FACTORY.slice(0, 12)}… curves=${BONDING_CURVES.length})`,
    );
  });
}

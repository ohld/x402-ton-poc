/**
 * x402-TON POC Server
 *
 * A paid TON analytics API that accepts USDT on TON via x402 protocol.
 *
 * Endpoints:
 * - GET /health           — free, server status
 * - GET /api/wallet/:addr — PAID, returns wallet analytics (balance, recent txs)
 * - GET /api/gasless-config — free, returns TONAPI gasless config for clients
 */

import express from "express";
import { paymentMiddleware } from "./middleware.js";
import { TonFacilitator } from "./facilitator.js";
import {
  TON_MAINNET,
  USDT_MASTER_MAINNET,
} from "./types.js";
import { Address } from "@ton/core";

// --- Config ---

const PORT = Number(process.env.PORT) || 4021;
const TONAPI_KEY = process.env.TONAPI_KEY || "";

// Seller's wallet address (where payments go)
// This should be your TON wallet address in raw format
const PAYEE_ADDRESS = process.env.TON_PAYEE_ADDRESS || "";

if (!PAYEE_ADDRESS) {
  console.error("ERROR: Set TON_PAYEE_ADDRESS env var (raw format: 0:abc...)");
  console.error("  Example: export TON_PAYEE_ADDRESS='0:abc123...'");
  process.exit(1);
}

// --- Price config ---
const PRICE_PER_REQUEST = "$0.01"; // $0.01 per API call
const AMOUNT_USDT_NANO = "10000"; // 0.01 USDT in 6-decimal nano units

// --- Setup ---

const app = express();
app.use(express.json());

const facilitator = new TonFacilitator({
  tonapiKey: TONAPI_KEY,
  expectedPayTo: PAYEE_ADDRESS,
  expectedToken: USDT_MASTER_MAINNET,
  minAmount: AMOUNT_USDT_NANO,
});

// --- x402 Payment Middleware ---

app.use(
  paymentMiddleware({
    routes: {
      "GET /api/wallet": {
        accepts: [
          {
            scheme: "exact",
            network: TON_MAINNET,
            price: PRICE_PER_REQUEST,
            payTo: PAYEE_ADDRESS,
            token: USDT_MASTER_MAINNET,
            description: "TON wallet analytics — balance, recent transactions, jetton holdings",
          },
        ],
        description: "TON Wallet Analytics API",
      },
    },
    facilitator,
  })
);

// --- Free endpoints ---

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "x402-ton-poc",
    version: "0.1.0",
    protocol: "x402",
    network: TON_MAINNET,
    payee: PAYEE_ADDRESS,
    price: PRICE_PER_REQUEST,
  });
});

app.get("/api/gasless-config", async (_req, res) => {
  try {
    const config = await facilitator.getGaslessConfig();
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Paid endpoint: Wallet Analytics ---

app.get("/api/wallet", async (req, res) => {
  const addr = req.query.address as string;
  if (!addr) {
    res.status(400).json({ error: "Missing ?address= query parameter" });
    return;
  }

  try {
    // Validate address
    let rawAddress: string;
    try {
      const parsed = Address.parse(addr);
      rawAddress = `${parsed.workChain}:${parsed.hash.toString("hex")}`;
    } catch {
      res.status(400).json({ error: "Invalid TON address format" });
      return;
    }

    // Fetch wallet data from TONAPI
    const headers: Record<string, string> = {};
    if (TONAPI_KEY) {
      headers["Authorization"] = `Bearer ${TONAPI_KEY}`;
    }

    const [accountRes, jettonsRes, eventsRes] = await Promise.all([
      fetch(`https://tonapi.io/v2/accounts/${rawAddress}`, { headers }),
      fetch(`https://tonapi.io/v2/accounts/${rawAddress}/jettons`, { headers }),
      fetch(`https://tonapi.io/v2/accounts/${rawAddress}/events?limit=10`, { headers }),
    ]);

    const account = await accountRes.json();
    const jettons = await jettonsRes.json();
    const events = await eventsRes.json();

    res.json({
      address: addr,
      rawAddress,
      balance: {
        ton: account.balance ? (Number(account.balance) / 1e9).toFixed(4) + " TON" : "0 TON",
        nanoton: account.balance || "0",
      },
      status: account.status,
      name: account.name || null,
      jettons: (jettons.balances || []).map((j: any) => ({
        symbol: j.jetton?.symbol || "???",
        name: j.jetton?.name || "Unknown",
        balance: j.balance,
        decimals: j.jetton?.decimals || 9,
        master: j.jetton?.address,
      })),
      recentEvents: (events.events || []).slice(0, 5).map((e: any) => ({
        id: e.event_id,
        timestamp: e.timestamp,
        actions: (e.actions || []).map((a: any) => ({
          type: a.type,
          status: a.status,
          ...(a.TonTransfer && {
            amount: (Number(a.TonTransfer.amount) / 1e9).toFixed(4) + " TON",
            sender: a.TonTransfer.sender?.address,
            recipient: a.TonTransfer.recipient?.address,
          }),
          ...(a.JettonTransfer && {
            amount: a.JettonTransfer.amount,
            symbol: a.JettonTransfer.jetton?.symbol,
            sender: a.JettonTransfer.sender?.address,
            recipient: a.JettonTransfer.recipient?.address,
          }),
        })),
      })),
      _meta: {
        powered_by: "x402-ton-poc",
        paid_with: "USDT on TON via x402",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch wallet data: ${err.message}` });
  }
});

// --- Start ---

app.listen(PORT, () => {
  console.log(`\n  x402-TON POC Server`);
  console.log(`  ====================`);
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Network: ${TON_MAINNET}`);
  console.log(`  Payee:   ${PAYEE_ADDRESS}`);
  console.log(`  Price:   ${PRICE_PER_REQUEST} per request`);
  console.log(`  Token:   USDT (${USDT_MASTER_MAINNET.slice(0, 20)}...)`);
  console.log(`\n  Endpoints:`);
  console.log(`  GET /health              — free`);
  console.log(`  GET /api/gasless-config  — free`);
  console.log(`  GET /api/wallet?address= — paid (${PRICE_PER_REQUEST})\n`);
});

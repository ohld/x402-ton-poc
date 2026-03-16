/**
 * x402-TON — Merchant Server Example
 *
 * A paid API that accepts USDT on TON via x402 protocol.
 * The merchant makes ZERO blockchain calls — the facilitator handles everything.
 *
 * Compare with EVM:  same pattern, same middleware, different network ID.
 * Compare with SVM:  same pattern, same middleware, different network ID.
 */

import express from "express";
import { paymentMiddleware } from "./middleware.js";
import { TonFacilitator } from "./facilitator.js";
import { TVM_MAINNET, USDT_MASTER } from "./types.js";

const PORT = Number(process.env.PORT) || 4021;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://ton-facilitator.okhlopkov.com";
const PAYEE_ADDRESS = process.env.TON_PAYEE_ADDRESS || "";

if (!PAYEE_ADDRESS) {
  console.error("Set TON_PAYEE_ADDRESS (raw format: 0:hex...)");
  process.exit(1);
}

const app = express();
app.use(express.json());

const facilitator = new TonFacilitator({ facilitatorUrl: FACILITATOR_URL });

// --- x402 payment wall: $0.01 per request ---
app.use(
  paymentMiddleware({
    routes: {
      "GET /api/data": {
        accepts: [{
          scheme: "exact",
          network: TVM_MAINNET,
          amount: "10000",  // 0.01 USDT (6 decimals)
          payTo: PAYEE_ADDRESS,
          asset: USDT_MASTER,
          facilitatorUrl: FACILITATOR_URL,
        }],
      },
    },
    facilitator,
  })
);

// --- Paid endpoint ---
app.get("/api/data", (_req, res) => {
  res.json({
    message: "You paid $0.01 in USDT on TON to access this data",
    timestamp: new Date().toISOString(),
    weather: { city: "Tokyo", temp: 22, condition: "sunny" },
  });
});

// --- Free endpoint ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok", network: TVM_MAINNET, facilitator: FACILITATOR_URL });
});

app.listen(PORT, () => {
  console.log(`x402-TON Server: http://localhost:${PORT}`);
  console.log(`  Paid: GET /api/data ($0.01 USDT)`);
  console.log(`  Free: GET /health`);
});

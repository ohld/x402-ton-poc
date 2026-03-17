/**
 * x402-TON — Merchant Server Example (SDK version)
 *
 * A paid API that accepts USDT on TON via x402 protocol.
 * Uses @x402/express + @x402/tvm — identical pattern to EVM/Solana examples.
 */

import { config } from "dotenv";
import express, { type RequestHandler } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactTvmScheme } from "@x402/tvm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

config();

const PORT = Number(process.env.PORT) || 4021;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://ton-facilitator.okhlopkov.com";
const PAYEE_ADDRESS = process.env.TON_PAYEE_ADDRESS;

if (!PAYEE_ADDRESS) {
  console.error("Set TON_PAYEE_ADDRESS (raw format: 0:hex...)");
  process.exit(1);
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const server = new x402ResourceServer(facilitatorClient)
  .register("tvm:-239", new ExactTvmScheme());

const app = express();

// Cast needed: @x402/express targets Express v4 types, this project uses Express v5
app.use(
  paymentMiddleware(
    {
      "GET /api/data": {
        accepts: [{
          scheme: "exact",
          price: "$0.01",
          network: "tvm:-239",
          payTo: PAYEE_ADDRESS,
          extra: { facilitatorUrl: FACILITATOR_URL },
        }],
        description: "Paid weather data",
        mimeType: "application/json",
      },
    },
    server,
  ) as unknown as RequestHandler,
);

app.get("/api/data", (_req, res) => {
  res.json({
    message: "You paid $0.01 USDT on TON for this data",
    timestamp: new Date().toISOString(),
    weather: { city: "Tokyo", temp: 22, condition: "sunny" },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", network: "tvm:-239", facilitator: FACILITATOR_URL });
});

app.listen(PORT, () => {
  console.log(`x402-TON Server: http://localhost:${PORT}`);
  console.log(`  Paid: GET /api/data ($0.01 USDT on TON)`);
  console.log(`  Free: GET /health`);
});

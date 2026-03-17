/**
 * x402-TON — Client (Buyer) Example (SDK version)
 *
 * Pays for an API resource using USDT on TON.
 * Uses @x402/fetch + @x402/tvm — identical pattern to EVM/Solana examples.
 *
 * Usage: npm run client
 */

import { config } from "dotenv";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactTvmScheme } from "@x402/tvm/exact/client";
import { toClientTvmSigner } from "@x402/tvm";
import { mnemonicToPrivateKey } from "@ton/crypto";

config();

const SERVER_URL = process.env.SERVER_URL || "http://localhost:4021";

async function main() {
  const mnemonic = process.env.TON_WALLET_MNEMONIC;
  if (!mnemonic) {
    console.error("Set TON_WALLET_MNEMONIC in .env");
    process.exit(1);
  }

  const keyPair = await mnemonicToPrivateKey(mnemonic.split(" "));
  const signer = toClientTvmSigner(keyPair);

  const client = new x402Client();
  client.register("tvm:*", new ExactTvmScheme(signer));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  console.log(`Requesting: ${SERVER_URL}/api/data\n`);
  const response = await fetchWithPayment(`${SERVER_URL}/api/data`);
  const body = await response.json();
  console.log("Response:", body);

  const httpClient = new x402HTTPClient(client);
  const payment = httpClient.getPaymentSettleResponse(
    (name) => response.headers.get(name),
  );
  if (payment) {
    console.log("\nPayment:", JSON.stringify(payment, null, 2));
  }
}

main().catch(console.error);

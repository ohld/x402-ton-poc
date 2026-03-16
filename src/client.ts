/**
 * x402-TON — Client (Buyer) Example
 *
 * Pays for an API resource using USDT on TON. Zero blockchain calls.
 *
 * Flow:
 * 1. GET /api/data → 402 + payment requirements
 * 2. Call facilitator /prepare → get messages to sign
 * 3. Sign with W5R1 wallet (offline, no gas needed)
 * 4. Retry with X-PAYMENT header → 200 + data
 *
 * Usage: source .env && npm run client
 */

import { WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { beginCell, internal, SendMode, external, storeMessage, Cell } from "@ton/core";
import {
  PaymentRequired, PrepareResponse, TVM_MAINNET, USDT_MASTER,
  HEADER_PAYMENT_REQUIRED, HEADER_PAYMENT, HEADER_PAYMENT_RESPONSE,
} from "./types.js";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:4021";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://ton-facilitator.okhlopkov.com";

async function main() {
  // Step 1: Request paid resource
  const url = `${SERVER_URL}/api/data`;
  const resp = await fetch(url);

  if (resp.status !== 402) {
    console.log(resp.status === 200 ? "Got data without payment:" : "Error:", await resp.text());
    return;
  }

  const prHeader = resp.headers.get(HEADER_PAYMENT_REQUIRED.toLowerCase());
  if (!prHeader) throw new Error("No payment requirements in 402 response");

  const { accepts } = JSON.parse(Buffer.from(prHeader, "base64").toString()) as PaymentRequired;
  const req = accepts[0]!;
  console.log(`Payment required: ${req.amount} nano USDT on ${req.network}`);

  // Step 2: Prepare (facilitator resolves seqno + builds jetton transfer)
  const mnemonic = process.env.TON_WALLET_MNEMONIC;
  if (!mnemonic) { console.log("Set TON_WALLET_MNEMONIC in .env"); return; }

  const keyPair = await mnemonicToPrivateKey(mnemonic.split(" "));
  const wallet = WalletContractV5R1.create({ publicKey: keyPair.publicKey });

  const prepareResp = await fetch(`${req.facilitatorUrl || FACILITATOR_URL}/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: wallet.address.toRawString(),
      walletPublicKey: keyPair.publicKey.toString("hex"),
      paymentRequirements: { scheme: req.scheme, network: req.network, amount: req.amount, payTo: req.payTo, asset: req.asset },
    }),
  });
  if (!prepareResp.ok) throw new Error(`/prepare failed: ${await prepareResp.text()}`);
  const prepare = await prepareResp.json() as PrepareResponse;

  // Step 3: Sign (offline, zero blockchain calls)
  const body = wallet.createTransfer({
    seqno: prepare.seqno,
    authType: "internal",
    timeout: prepare.validUntil,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: prepare.messages.map(m => internal({
      to: m.address,
      value: BigInt(m.amount),
      body: m.payload ? Cell.fromBoc(Buffer.from(m.payload, "base64"))[0] : undefined,
    })),
  });

  const boc = beginCell()
    .storeWritable(storeMessage(external({
      to: wallet.address,
      init: prepare.seqno === 0 ? wallet.init : undefined,
      body,
    })))
    .endCell().toBoc().toString("base64");

  // Step 4: Pay and get data
  const payload = {
    scheme: "exact", network: TVM_MAINNET,
    payload: {
      from: wallet.address.toRawString(), to: req.payTo, tokenMaster: req.asset,
      amount: req.amount, validUntil: prepare.validUntil,
      nonce: crypto.randomUUID(), settlementBoc: boc,
      walletPublicKey: keyPair.publicKey.toString("hex"),
    },
  };

  const paidResp = await fetch(url, {
    headers: { [HEADER_PAYMENT]: Buffer.from(JSON.stringify(payload)).toString("base64") },
  });

  const prResp = paidResp.headers.get(HEADER_PAYMENT_RESPONSE.toLowerCase());
  if (prResp) {
    const pr = JSON.parse(Buffer.from(prResp, "base64").toString());
    console.log(pr.success ? `Paid! TX: ${pr.txHash}` : `Payment failed: ${pr.error}`);
  }

  if (paidResp.ok) console.log("Data:", await paidResp.json());
}

main().catch(console.error);

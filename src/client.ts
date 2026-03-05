/**
 * x402-TON POC Client
 *
 * Demonstrates the buyer flow:
 * 1. Request a paid resource → get 402 with payment requirements
 * 2. Build a gasless USDT payment via TONAPI
 * 3. Sign with W5R1 wallet
 * 4. Resend request with payment header → get resource
 *
 * Usage:
 *   # Load env from .env file
 *   source .env && npm run client
 */

import { WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import {
  Address,
  beginCell,
  internal,
  toNano,
  SendMode,
  external,
  storeMessage,
  storeMessageRelaxed,
} from "@ton/core";
import { TonApiClient } from "@ton-api/client";
import { ContractAdapter } from "@ton-api/ton-adapter";
import {
  TonPaymentPayload,
  PaymentRequired,
  PaymentResponse,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
  TON_MAINNET,
} from "./types.js";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:4021";
const TARGET_ADDRESS =
  process.env.TARGET_ADDRESS ||
  "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2";

// --- TONAPI Client ---
const ta = new TonApiClient({
  baseUrl: "https://tonapi.io",
  apiKey: process.env.TONAPI_KEY || undefined,
});
const provider = new ContractAdapter(ta);

const BASE_JETTON_SEND_AMOUNT = toNano(0.05);

async function main() {
  console.log("\n=== x402-TON Client ===\n");

  // --- Step 1: Request the paid resource (expect 402) ---
  console.log(`1. Requesting wallet data for ${TARGET_ADDRESS}...`);
  const url = `${SERVER_URL}/api/wallet?address=${TARGET_ADDRESS}`;

  const initialResponse = await fetch(url);
  console.log(`   Status: ${initialResponse.status}`);

  if (initialResponse.status !== 402) {
    if (initialResponse.ok) {
      console.log("   Resource returned without payment (unexpected)");
      console.log("   Data:", JSON.stringify(await initialResponse.json(), null, 2));
    } else {
      console.error("   Unexpected error:", await initialResponse.text());
    }
    return;
  }

  // --- Step 2: Parse payment requirements ---
  const prHeader = initialResponse.headers.get(HEADER_PAYMENT_REQUIRED.toLowerCase());
  if (!prHeader) {
    console.error("   No X-PAYMENT-REQUIRED header in 402 response");
    return;
  }

  const paymentRequired: PaymentRequired = JSON.parse(
    Buffer.from(prHeader, "base64").toString("utf-8")
  );
  const option = paymentRequired.accepts[0]!;
  console.log("\n2. Payment required:");
  console.log(`   Price:   ${option.price}`);
  console.log(`   Network: ${option.network}`);
  console.log(`   Pay to:  ${option.payTo}`);

  // --- Step 3: Build & sign gasless payment ---
  const mnemonic = process.env.TON_WALLET_MNEMONIC;
  if (!mnemonic) {
    console.log("\n3. [DEMO MODE] No TON_WALLET_MNEMONIC set.");
    console.log('   source .env && npm run client');
    return;
  }

  console.log("\n3. Building gasless USDT payment...");

  const keyPair = await mnemonicToPrivateKey(mnemonic.split(" "));
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const contract = provider.open(wallet);

  console.log(`   Wallet: ${wallet.address.toString({ bounceable: false })}`);

  // Resolve our jetton wallet address for USDT
  // option.token is raw format (0:hex...) from server
  const usdtMaster = Address.parseRaw(option.token);
  const jettonWalletResult = await ta.blockchain.execGetMethodForBlockchainAccount(
    usdtMaster,
    "get_wallet_address",
    { args: [wallet.address.toRawString()] }
  );
  // SDK may return camelCase or snake_case depending on version
  const decoded = jettonWalletResult.decoded as any;
  const jettonWalletAddr = decoded.jettonWalletAddress || decoded.jetton_wallet_address;
  if (!jettonWalletAddr) {
    console.error("   Failed to resolve jetton wallet. Decoded:", JSON.stringify(decoded));
    return;
  }
  const jettonWallet = Address.parseRaw(jettonWalletAddr);
  console.log(`   Jetton wallet: ${jettonWallet.toString()}`);

  // Get relay address for excess
  const gaslessConfig = await ta.gasless.gaslessConfig();
  const relayAddress = gaslessConfig.relayAddress;
  console.log(`   Relay: ${relayAddress.toString()}`);

  // Build jetton transfer payload
  const payTo = Address.parseRaw(option.payTo);
  const jettonAmount = priceToNano(option.price);
  console.log(`   Amount: ${jettonAmount} (${option.price} USDT)`);

  const transferPayload = beginCell()
    .storeUint(0xf8a7ea5, 32) // op: jetton_transfer
    .storeUint(0, 64) // query_id
    .storeCoins(jettonAmount) // jetton amount
    .storeAddress(payTo) // destination
    .storeAddress(relayAddress) // response_destination (excess → relay for cheaper fee)
    .storeBit(false) // no custom_payload
    .storeCoins(1n) // forward_ton_amount (1 nanoton for notification)
    .storeMaybeRef(undefined) // no forward_payload
    .endCell();

  const messageToEstimate = beginCell()
    .storeWritable(
      storeMessageRelaxed(
        internal({
          to: jettonWallet,
          bounce: true,
          value: BASE_JETTON_SEND_AMOUNT,
          body: transferPayload,
        })
      )
    )
    .endCell();

  // Estimate gasless fee
  console.log("   Estimating gasless fee...");
  const params = await ta.gasless.gaslessEstimate(usdtMaster, {
    walletAddress: wallet.address,
    walletPublicKey: keyPair.publicKey.toString("hex"),
    messages: [{ boc: messageToEstimate }],
  });
  console.log(`   Estimated messages: ${params.messages.length}`);

  // Get seqno
  const seqno = await contract.getSeqno();
  console.log(`   Seqno: ${seqno}`);

  // Build and sign the W5R1 transfer
  const validUntil = Math.ceil(Date.now() / 1000) + 5 * 60;
  const transferBody = wallet.createTransfer({
    seqno,
    authType: "internal",
    timeout: validUntil,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: params.messages.map((message) =>
      internal({
        to: message.address,
        value: BigInt(message.amount),
        body: message.payload,
      })
    ),
  });

  // Wrap in external message
  const extMessage = beginCell()
    .storeWritable(
      storeMessage(
        external({
          to: contract.address,
          init: seqno === 0 ? contract.init : undefined,
          body: transferBody,
        })
      )
    )
    .endCell();

  const bocBase64 = extMessage.toBoc().toString("base64");
  console.log(`   Signed BOC: ${bocBase64.slice(0, 40)}...`);

  // Build x402 payment payload
  const nonce = crypto.randomUUID();
  const x402Payload: TonPaymentPayload = {
    scheme: "exact",
    network: TON_MAINNET,
    payload: {
      from: wallet.address.toRawString(),
      to: option.payTo,
      tokenMaster: option.token,
      amount: jettonAmount.toString(),
      validUntil,
      nonce,
      signedMessages: params.messages.map((m) => ({
        address: m.address.toString(),
        amount: m.amount.toString(),
        payload: m.payload
          ? beginCell().storeSlice(m.payload.beginParse()).endCell().toBoc().toString("base64")
          : "",
      })),
      commission: "0", // Commission is bundled in the estimate messages
    },
  };

  // The real settlement BOC (what gets sent to TONAPI gasless/send)
  // We attach it as a special field so the server can settle
  (x402Payload as any)._settlementBoc = bocBase64;
  (x402Payload as any)._walletPublicKey = keyPair.publicKey.toString("hex");

  // --- Step 4: Resend with payment ---
  console.log("\n4. Sending request with payment header...");
  const paymentEncoded = Buffer.from(JSON.stringify(x402Payload)).toString("base64");

  const paidResponse = await fetch(url, {
    headers: {
      [HEADER_PAYMENT_SIGNATURE]: paymentEncoded,
    },
  });

  console.log(`   Status: ${paidResponse.status}`);

  // Check payment response header
  const prRespHeader = paidResponse.headers.get(HEADER_PAYMENT_RESPONSE.toLowerCase());
  if (prRespHeader) {
    const paymentResponse: PaymentResponse = JSON.parse(
      Buffer.from(prRespHeader, "base64").toString("utf-8")
    );
    console.log(
      `   Payment: ${paymentResponse.success ? "SUCCESS" : "FAILED"}`
    );
    if (paymentResponse.txHash) console.log(`   TX: ${paymentResponse.txHash}`);
    if (paymentResponse.error) console.error(`   Error: ${paymentResponse.error}`);
  }

  if (paidResponse.ok) {
    const data = await paidResponse.json();
    console.log("\n5. Wallet Analytics Data:");
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.error("   Failed:", await paidResponse.text());
  }
}

function priceToNano(price: string): bigint {
  const usd = parseFloat(price.replace("$", ""));
  return BigInt(Math.round(usd * 1e6));
}

main().catch(console.error);

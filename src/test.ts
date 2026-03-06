/**
 * x402-TON POC Tests
 *
 * Validates the protocol flow without real blockchain transactions.
 * Tests: 402 response format, payment verification, header encoding.
 *
 * Usage: npm test
 */

import {
  PaymentRequired,
  TonPaymentPayload,
  PaymentResponse,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
  TON_MAINNET,
  USDT_MASTER_MAINNET,
} from "./types.js";
import { TonFacilitator } from "./facilitator.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

// --- Test PaymentRequired encoding ---

function testPaymentRequiredEncoding() {
  console.log("\n--- PaymentRequired Encoding ---");

  const pr: PaymentRequired = {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: TON_MAINNET,
        price: "$0.01",
        payTo: "0:abc123",
        token: USDT_MASTER_MAINNET,
        description: "Test resource",
      },
    ],
  };

  const encoded = Buffer.from(JSON.stringify(pr)).toString("base64");
  const decoded: PaymentRequired = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));

  assert(decoded.x402Version === 1, "x402Version preserved");
  assert(decoded.accepts.length === 1, "accepts array preserved");
  assert(decoded.accepts[0].scheme === "exact", "scheme preserved");
  assert(decoded.accepts[0].network === TON_MAINNET, "network preserved");
  assert(decoded.accepts[0].price === "$0.01", "price preserved");
  assert(decoded.accepts[0].payTo === "0:abc123", "payTo preserved");
  assert(decoded.accepts[0].token === USDT_MASTER_MAINNET, "token preserved");
}

// --- Test Facilitator Verification ---

function testFacilitatorVerification() {
  console.log("\n--- Facilitator Verification ---");

  const payTo = "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";
  const facilitator = new TonFacilitator({
    expectedPayTo: payTo,
    expectedToken: USDT_MASTER_MAINNET,
    minAmount: "10000", // 0.01 USDT
  });

  // Valid payload
  const validPayload: TonPaymentPayload = {
    scheme: "exact",
    network: TON_MAINNET,
    payload: {
      from: "0:sender123",
      to: payTo,
      tokenMaster: USDT_MASTER_MAINNET,
      amount: "10000",
      validUntil: Math.floor(Date.now() / 1000) + 300,
      nonce: "test-nonce-1",
      signedMessages: [{ address: payTo, amount: "0", payload: "base64boc" }],
      commission: "5000",
    },
  };

  const result = facilitator.verify(validPayload);
  assert(result.valid === true, "Valid payload passes verification");

  // Wrong recipient
  const wrongRecipient: TonPaymentPayload = {
    ...validPayload,
    payload: { ...validPayload.payload, to: "0:wrong_address", nonce: "test-nonce-2" },
  };
  const r2 = facilitator.verify(wrongRecipient);
  assert(r2.valid === false, "Wrong recipient fails verification");
  assert(r2.error!.includes("Wrong recipient"), "Error mentions wrong recipient");

  // Wrong token
  const wrongToken: TonPaymentPayload = {
    ...validPayload,
    payload: { ...validPayload.payload, tokenMaster: "0:wrong_token", nonce: "test-nonce-3" },
  };
  const r3 = facilitator.verify(wrongToken);
  assert(r3.valid === false, "Wrong token fails verification");

  // Wrong amount (must be exact match)
  const wrongAmount: TonPaymentPayload = {
    ...validPayload,
    payload: { ...validPayload.payload, amount: "1", nonce: "test-nonce-4" },
  };
  const r4 = facilitator.verify(wrongAmount);
  assert(r4.valid === false, "Wrong amount fails verification");
  assert(r4.error!.includes("mismatch"), "Error mentions amount mismatch");

  // Expired payment
  const expired: TonPaymentPayload = {
    ...validPayload,
    payload: { ...validPayload.payload, validUntil: 1000000000, nonce: "test-nonce-5" },
  };
  const r5 = facilitator.verify(expired);
  assert(r5.valid === false, "Expired payment fails verification");

  // Empty signed messages
  const noSig: TonPaymentPayload = {
    ...validPayload,
    payload: { ...validPayload.payload, signedMessages: [], nonce: "test-nonce-6" },
  };
  const r6 = facilitator.verify(noSig);
  assert(r6.valid === false, "No signed messages fails verification");
}

// --- Test Replay Protection ---

function testReplayProtection() {
  console.log("\n--- Replay Protection ---");

  const payTo = "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";
  const facilitator = new TonFacilitator({
    expectedPayTo: payTo,
    expectedToken: USDT_MASTER_MAINNET,
    minAmount: "10000",
  });

  const payload: TonPaymentPayload = {
    scheme: "exact",
    network: TON_MAINNET,
    payload: {
      from: "0:sender123",
      to: payTo,
      tokenMaster: USDT_MASTER_MAINNET,
      amount: "10000",
      validUntil: Math.floor(Date.now() / 1000) + 300,
      nonce: "unique-nonce-replay-test",
      signedMessages: [{ address: payTo, amount: "0", payload: "base64boc" }],
      commission: "5000",
    },
  };

  // First verification should pass
  const r1 = facilitator.verify(payload);
  assert(r1.valid === true, "First submission passes");

  // Simulate settlement (adds nonce to used set)
  // We need to call settle which marks the nonce
  // For this test, manually trigger the nonce marking by calling settle
  // Since settle calls TONAPI which won't work in test, let's just test verify logic
  // The replay protection is in-memory, so we test the concept:

  // After marking nonce as used (simulated)
  (facilitator as any).settledNonces.add("unique-nonce-replay-test");

  const r2 = facilitator.verify(payload);
  assert(r2.valid === false, "Replay attempt blocked");
  assert(r2.error!.includes("replay"), "Error mentions replay");
}

// --- Test PaymentResponse encoding ---

function testPaymentResponseEncoding() {
  console.log("\n--- PaymentResponse Encoding ---");

  const success: PaymentResponse = {
    success: true,
    txHash: "abc123def456",
    network: TON_MAINNET,
  };

  const encoded = Buffer.from(JSON.stringify(success)).toString("base64");
  const decoded: PaymentResponse = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));

  assert(decoded.success === true, "Success status preserved");
  assert(decoded.txHash === "abc123def456", "TX hash preserved");
  assert(decoded.network === TON_MAINNET, "Network preserved");

  const failure: PaymentResponse = {
    success: false,
    error: "Insufficient funds",
  };

  const encoded2 = Buffer.from(JSON.stringify(failure)).toString("base64");
  const decoded2: PaymentResponse = JSON.parse(Buffer.from(encoded2, "base64").toString("utf-8"));

  assert(decoded2.success === false, "Failure status preserved");
  assert(decoded2.error === "Insufficient funds", "Error message preserved");
}

// --- Test Full HTTP Flow (without real server) ---

function testHTTPHeaders() {
  console.log("\n--- HTTP Header Names ---");

  assert(HEADER_PAYMENT_REQUIRED === "X-PAYMENT-REQUIRED", "Payment required header correct");
  assert(HEADER_PAYMENT_SIGNATURE === "X-PAYMENT", "Payment signature header correct");
  assert(HEADER_PAYMENT_RESPONSE === "X-PAYMENT-RESPONSE", "Payment response header correct");
}

// --- Test Price Conversion ---

function testPriceConversion() {
  console.log("\n--- Price Conversion ---");

  function priceToNano(price: string): string {
    const usd = parseFloat(price.replace("$", ""));
    return Math.round(usd * 1e6).toString();
  }

  assert(priceToNano("$0.01") === "10000", "$0.01 = 10000 nano");
  assert(priceToNano("$1.00") === "1000000", "$1.00 = 1000000 nano");
  assert(priceToNano("$0.001") === "1000", "$0.001 = 1000 nano");
  assert(priceToNano("$100") === "100000000", "$100 = 100000000 nano");
}

// --- Run all tests ---

console.log("=== x402-TON POC Tests ===");

testPaymentRequiredEncoding();
testFacilitatorVerification();
testReplayProtection();
testPaymentResponseEncoding();
testHTTPHeaders();
testPriceConversion();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

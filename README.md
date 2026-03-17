# x402-ton-poc

Proof-of-concept: paid HTTP API accepting USDT on TON via [x402](https://x402.org) protocol, built with the official `@x402/tvm` SDK.

**On-chain proof:** [5 successful mainnet payments](https://tonviewer.com/UQAqn8F5nDx8ZvQut25e33uzcBioLLreha4yYujGdrIuHzXX)

## How it compares

### Server (merchant) — identical across all chains

```typescript
// === TON ===
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactTvmScheme } from "@x402/tvm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL }))
  .register("tvm:-239", new ExactTvmScheme());

app.use(paymentMiddleware({
  "GET /api/data": {
    accepts: [{ scheme: "exact", price: "$0.01", network: "tvm:-239",
                payTo: "0:abc...", extra: { facilitatorUrl: FACILITATOR_URL } }],
  },
}, server));

// === EVM (for comparison) ===
const server = new x402ResourceServer(facilitatorClient)
  .register("eip155:8453", new ExactEvmScheme());

app.use(paymentMiddleware({
  "GET /api/data": {
    accepts: [{ scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: "0xabc..." }],
  },
}, server));
```

**Same `paymentMiddleware`, same `x402ResourceServer`, same `price: "$0.01"`.** The only difference is the network ID and scheme.

### Client (buyer) — 3 lines to set up

```typescript
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactTvmScheme } from "@x402/tvm/exact/client";
import { toClientTvmSigner } from "@x402/tvm";

const signer = toClientTvmSigner(keyPair);
const client = new x402Client().register("tvm:*", new ExactTvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Just use fetch — payment is automatic
const response = await fetchWithPayment("https://api.example.com/paid-data");
```

## Quick start

```bash
git clone https://github.com/ohld/x402-ton-poc.git
cd x402-ton-poc && npm install
cp .env.example .env
# Set TON_PAYEE_ADDRESS (your wallet, raw format 0:hex...)

# Terminal 1: server
npm run dev

# Terminal 2: client (needs TON_WALLET_MNEMONIC with USDT)
npm run client
```

## Files

```
src/
├── server.ts  — Express server with payment wall (merchant)
└── client.ts  — CLI client that pays and gets data (buyer)
```

## Payment flow

```
Client              Server               Facilitator              TON
  |--- GET /data ---->|                      |                      |
  |<-- 402 + reqs ----|                      |                      |
  | [SDK: /prepare] ----------------------->|                      |
  | [SDK: sign]       |                      |                      |
  |--- GET /data + X-PAYMENT header -------->|                      |
  |                   |--- /verify --------->|                      |
  |                   |--- /settle --------->|--- relay + gas ----->|
  |                   |<-- tx_hash ----------|<-- confirmed --------|
  |<-- 200 + data ----|                      |                      |
```

Client and server make **zero blockchain calls**. The SDK + facilitator handle seqno lookup, signing, gas sponsorship, and on-chain relay.

## Related

- [x402-ton-facilitator](https://github.com/ohld/x402-ton-facilitator) — Self-relay gas sponsorship service
- [x402 Protocol](https://github.com/coinbase/x402) — HTTP 402 payment standard
- [SDK PR #1583](https://github.com/coinbase/x402/pull/1583) — TVM mechanism for official x402 SDKs
- [Spec PR #1497](https://github.com/coinbase/x402/pull/1497) — TVM network specification

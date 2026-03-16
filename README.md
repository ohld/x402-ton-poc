# x402-ton-poc

Proof-of-concept: paid HTTP API accepting USDT on TON via [x402](https://x402.org) protocol.

**On-chain proof:** [5 successful mainnet payments](https://tonviewer.com/UQAqn8F5nDx8ZvQut25e33uzcBioLLreha4yYujGdrIuHzXX)

## How it compares

### Server (merchant) — same pattern across all chains

```typescript
// === TON ===
app.use(paymentMiddleware({
  routes: {
    "GET /api/data": {
      accepts: [{ scheme: "exact", network: "tvm:-239", amount: "10000",
                  payTo: "0:abc...", asset: USDT_MASTER, facilitatorUrl: "https://..." }],
    },
  },
  facilitator,
}));

// === EVM (for comparison) ===
app.use(paymentMiddleware({
  "GET /api/data": { price: "$0.01", network: "eip155:8453", payTo: "0xabc..." },
}, resourceServer));

// === Solana (for comparison) ===
app.use(paymentMiddleware({
  "GET /api/data": { price: "$0.01", network: "solana:5eykt...", payTo: "ABC..." },
}, resourceServer));
```

### Client (buyer) — zero blockchain calls on all chains

| Step | TON | EVM | Solana |
|------|-----|-----|--------|
| 1. Request resource | `fetch(url)` -> 402 | `fetch(url)` -> 402 | `fetch(url)` -> 402 |
| 2. Get signing data | `POST /prepare` -> seqno, messages | _built-in to SDK_ | _built-in to SDK_ |
| 3. Sign | `wallet.createTransfer()` | `signTypedData()` | `signTransaction()` |
| 4. Retry with payment | `fetch(url, {headers})` | `fetch(url, {headers})` | `fetch(url, {headers})` |
| Blockchain calls by client | **0** | **0** | **0** |
| Gas paid by | Facilitator (TON) | Facilitator (ETH) | Facilitator (SOL) |

## Quick start

```bash
git clone https://github.com/ohld/x402-ton-poc.git
cd x402-ton-poc && npm install
cp .env.example .env
# Set TON_PAYEE_ADDRESS (your wallet, raw format 0:hex...)

# Terminal 1: server
npm run dev

# Terminal 2: client (needs TON_WALLET_MNEMONIC with USDT)
source .env && npm run client
```

## Files

```
src/
├── server.ts       — Express server with payment wall (merchant)
├── client.ts       — CLI client that pays and gets data (buyer)
├── middleware.ts    — x402 payment middleware for Express
├── facilitator.ts  — HTTP client to facilitator /prepare /verify /settle
└── types.ts        — x402 protocol types and TON constants
```

## Architecture

```
Client              Server               Facilitator              TON
  |--- GET /data ---->|                      |                      |
  |<-- 402 + reqs ----|                      |                      |
  |--- POST /prepare ---------------------->|                      |
  |<-- {seqno, msgs} ----------------------|                      |
  | [sign offline]    |                      |                      |
  |--- GET /data + payment header --------->|                      |
  |                   |--- /verify --------->|                      |
  |                   |--- /settle --------->|--- relay + gas ----->|
  |                   |<-- tx_hash ----------|<-- confirmed --------|
  |<-- 200 + data ----|                      |                      |
```

Client and server make **zero blockchain calls**. The facilitator handles seqno lookup, gas sponsorship, and on-chain relay.

## Related

- [x402-ton-facilitator](https://github.com/ohld/x402-ton-facilitator) — Self-relay gas sponsorship service
- [x402 Protocol](https://github.com/coinbase/x402) — HTTP 402 payment standard
- [SDK PR #1583](https://github.com/coinbase/x402/pull/1583) — TVM mechanism for official x402 SDKs

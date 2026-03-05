# x402-ton-poc

**x402 Payment Protocol + USDT on TON Blockchain**

A working proof-of-concept implementing the [x402](https://x402.org) open payment standard with TON blockchain. Any HTTP API can accept USDT payments via gasless W5 wallet transactions — the client never needs TON for gas.

## On-chain proof

Real USDT payment (0.01 USDT) settled via x402 flow on TON mainnet:
[tonviewer.com/transaction/2a70f5d...](https://tonviewer.com/transaction/2a70f5dfef76bdd74193e4710c9583c960321ce82369bfed7db93cb15e6daa88)

## Architecture

```
Client                          Server                      Gasless Relay
  |                               |                              |
  |-- GET /api/wallet ----------->|                              |
  |<-- 402 + PaymentRequired -----|                              |
  |                               |                              |
  |-- GET gasless/estimate -------|------------------------------>|
  |<-- SignRawParams -------------|-------------------------------|
  |                               |                              |
  |-- sign with W5 key           |                              |
  |                               |                              |
  |-- GET /api/wallet ----------->|                              |
  |   + X-PAYMENT header         |                              |
  |                               |-- verify payload             |
  |                               |-- POST gasless/send -------->|
  |                               |<-- settlement result --------|
  |<-- 200 + wallet data --------|                              |
```

**How gasless works on TON:**

TON Wallet V5 (W5) supports `internal_signed` messages — the user signs a batch of jetton transfers off-chain, and a relay submits them on-chain paying gas. This maps directly to x402's facilitator model:

| x402 concept | TON equivalent |
|---|---|
| Facilitator | Gasless relay (e.g. TONAPI) |
| EIP-3009 `transferWithAuthorization` | W5 `internal_signed` message |
| Gas sponsorship | Relay wraps in internal msg carrying TON for fees |

## Quick start

```bash
# Install dependencies
npm install

# Run tests (30 tests, no wallet needed)
npm test

# Copy env template
cp .env.example .env
# Edit .env with your values

# Start the paid API server
npm run dev

# In another terminal — trigger a 402 response
curl -v http://localhost:4021/api/wallet?address=EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2

# Run client in demo mode (no wallet)
npm run client

# Run client with real payment
source .env && npm run client
```

## Project structure

```
src/
  types.ts        — x402 protocol types adapted for TON
  middleware.ts    — Express middleware (returns 402, verifies payments)
  facilitator.ts  — Gasless integration (verify + settle via relay)
  server.ts       — Demo API server (paid TON wallet analytics)
  client.ts       — Demo client (handles 402, signs W5 payment, resends)
  test.ts         — 30 unit tests for protocol flow
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `TON_PAYEE_ADDRESS` | Yes | Your wallet address (raw format `0:hex...`) |
| `TONAPI_KEY` | No | TONAPI key for higher rate limits |
| `TON_WALLET_MNEMONIC` | Client only | 24-word mnemonic for W5 wallet |
| `PORT` | No | Server port (default: 4021) |
| `TARGET_ADDRESS` | No | Address to query (client) |

## What's implemented

- [x] x402 protocol types for TON (PaymentRequired, PaymentPayload, PaymentResponse)
- [x] Express middleware — returns 402 with payment requirements
- [x] Facilitator — verifies payment intent + settles via gasless relay
- [x] Demo server — paid TON wallet analytics endpoint
- [x] Demo client — full payment flow with W5R1 signing
- [x] Real on-chain settlement (USDT on TON mainnet)
- [x] 30 unit tests

## Related

- [x402 spec PR for TON](https://github.com/coinbase/x402) (pending)
- [x402 Standard](https://x402.org)
- [x402 GitHub](https://github.com/coinbase/x402)
- [W5 Wallet Contract](https://github.com/ton-blockchain/wallet-contract-v5)
- [TONAPI Gasless API](https://docs.tonconsole.com/tonapi/rest-api/gasless)
- [TEP-74 Jetton Standard](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md)

## License

MIT

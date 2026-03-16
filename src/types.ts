/**
 * x402 Protocol Types for TON Blockchain
 *
 * Self-relay architecture: the facilitator handles all blockchain interaction.
 * Client signs offline, merchant adds middleware, facilitator sponsors gas.
 *
 * Network ID: "tvm:-239" (CAIP-2 format, TON mainnet)
 */

// --- x402 Protocol Headers ---

/** Server -> Client: included with HTTP 402 response */
export interface PaymentRequired {
  x402Version: 2;
  accepts: PaymentOption[];
  error?: string;
}

/** A single accepted payment method */
export interface PaymentOption {
  scheme: "exact";
  network: string;
  /** Amount in token's smallest unit (nano for USDT) */
  amount: string;
  /** Recipient wallet address (raw format: 0:hex) */
  payTo: string;
  /** Jetton master contract address (raw format: 0:hex) */
  asset: string;
  /** Facilitator URL for /prepare, /verify, /settle */
  facilitatorUrl: string;
  description?: string;
}

/** Client -> Server: X-PAYMENT header payload */
export interface TonPaymentPayload {
  scheme: "exact";
  network: string;
  payload: {
    /** Sender wallet address (raw format: 0:hex) */
    from: string;
    /** Recipient wallet address (raw format: 0:hex) */
    to: string;
    /** Jetton master contract address (raw format: 0:hex) */
    tokenMaster: string;
    /** Amount in token's smallest unit */
    amount: string;
    /** Valid until unix timestamp */
    validUntil: number;
    /** Random nonce for replay protection */
    nonce: string;
    /** Signed W5 external message BoC (base64, contains internal_signed body) */
    settlementBoc: string;
    /** Sender's Ed25519 public key (hex) */
    walletPublicKey: string;
  };
}

/** Server -> Client: X-PAYMENT-RESPONSE header */
export interface PaymentResponse {
  success: boolean;
  txHash?: string;
  network?: string;
  error?: string;
}

/** Response from facilitator /prepare endpoint */
export interface PrepareResponse {
  seqno: number;
  validUntil: number;
  walletId: number;
  messages: Array<{
    address: string;
    amount: string;
    payload: string;
  }>;
}

// --- TON-specific constants ---

export const TVM_MAINNET = "tvm:-239";
export const TVM_TESTNET = "tvm:-3";

/** USDT Jetton Master on TON mainnet */
export const USDT_MASTER = "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";

// --- Header names ---
export const HEADER_PAYMENT_REQUIRED = "X-PAYMENT-REQUIRED";
export const HEADER_PAYMENT = "X-PAYMENT";
export const HEADER_PAYMENT_RESPONSE = "X-PAYMENT-RESPONSE";

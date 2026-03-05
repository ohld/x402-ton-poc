/**
 * x402 Protocol Types for TON Blockchain
 *
 * Implements the x402 payment standard with TON-specific types.
 * Network ID: "ton:mainnet" (basechain workchain 0)
 */

// --- x402 Protocol Headers ---

/** Server -> Client: included with HTTP 402 response */
export interface PaymentRequired {
  /** x402 protocol version */
  x402Version: 1;
  /** Accepted payment options for this resource */
  accepts: PaymentOption[];
  /** Human-readable error message */
  error?: string;
}

/** A single accepted payment method */
export interface PaymentOption {
  /** Payment scheme identifier */
  scheme: "exact";
  /** Network identifier (CAIP-2 style) */
  network: string;
  /** Price in USD (e.g. "$0.01") */
  price: string;
  /** Recipient wallet address */
  payTo: string;
  /** Token to pay with */
  token: string;
  /** Human-readable description */
  description?: string;
}

/** Client -> Server: PAYMENT-SIGNATURE header (Base64 JSON) */
export interface TonPaymentPayload {
  /** Must be "exact" */
  scheme: "exact";
  /** Must be "ton:mainnet" or "ton:testnet" */
  network: string;
  /** Payment details */
  payload: {
    /** Sender wallet address (raw format: 0:hex) */
    from: string;
    /** Recipient wallet address (raw format: 0:hex) */
    to: string;
    /** Jetton master contract address (raw format: 0:hex) */
    tokenMaster: string;
    /** Amount in token's smallest unit (nano for USDT = 6 decimals) */
    amount: string;
    /** Valid until unix timestamp */
    validUntil: number;
    /** Random nonce for replay protection */
    nonce: string;
    /**
     * Signed messages for W5 wallet (from TONAPI gasless/estimate).
     * This is the SignRawParams that the client signs with their W5 wallet.
     */
    signedMessages: SignedW5Message[];
    /** Commission amount in token units (paid to relay) */
    commission: string;
  };
}

/** A signed W5 internal message (from TONAPI gasless flow) */
export interface SignedW5Message {
  /** Destination address */
  address: string;
  /** Amount in nanoTON (usually "0" for jetton transfers) */
  amount: string;
  /** Payload as base64 BOC */
  payload: string;
  /** State init as base64 BOC (optional) */
  stateInit?: string;
}

/** Server -> Client: PAYMENT-RESPONSE header */
export interface PaymentResponse {
  /** Whether payment was successful */
  success: boolean;
  /** Transaction hash on TON (if settled) */
  txHash?: string;
  /** Network used */
  network?: string;
  /** Error message if failed */
  error?: string;
}

// --- TON-specific constants ---

export const TON_MAINNET = "ton:mainnet";
export const TON_TESTNET = "ton:testnet";

/** USDT Jetton Master on TON mainnet */
export const USDT_MASTER_MAINNET = "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";

/** USDT Jetton Master on TON testnet */
export const USDT_MASTER_TESTNET = "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";

// --- Header names ---
export const HEADER_PAYMENT_REQUIRED = "X-PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "X-PAYMENT";
export const HEADER_PAYMENT_RESPONSE = "X-PAYMENT-RESPONSE";

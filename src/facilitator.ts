/**
 * TON Facilitator — verifies and settles payments via TONAPI Gasless API.
 *
 * In x402 terms, the facilitator:
 * 1. Verifies that the payment payload is valid (correct amount, recipient, not expired)
 * 2. Settles the payment on-chain (submits the signed W5 message via TONAPI relay)
 *
 * Uses TONAPI's gasless endpoints:
 * - GET  /v2/gasless/config     — supported tokens, relay address
 * - POST /v2/gasless/estimate   — get signing payload + commission estimate
 * - POST /v2/gasless/send       — submit signed W5 message for on-chain settlement
 */

import { TonPaymentPayload, PaymentResponse, USDT_MASTER_MAINNET } from "./types.js";

const TONAPI_BASE = "https://tonapi.io";

export interface FacilitatorConfig {
  /** TONAPI key (optional, increases rate limits) */
  tonapiKey?: string;
  /** Expected recipient address (raw format) */
  expectedPayTo: string;
  /** Expected token master address */
  expectedToken: string;
  /** Minimum payment amount in token units */
  minAmount: string;
}

export class TonFacilitator {
  private config: FacilitatorConfig;
  private settledNonces = new Set<string>();

  constructor(config: FacilitatorConfig) {
    this.config = config;
  }

  /**
   * Verify a payment payload without settling.
   * Checks: amount, recipient, token, expiry, replay.
   */
  verify(payload: TonPaymentPayload): { valid: boolean; error?: string } {
    const { to, tokenMaster, amount, validUntil, nonce, signedMessages } = payload.payload;

    // Check replay
    if (this.settledNonces.has(nonce)) {
      return { valid: false, error: "Nonce already used (replay)" };
    }

    // Check expiry
    if (validUntil < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: "Payment expired" };
    }

    // Check recipient
    if (to !== this.config.expectedPayTo) {
      return { valid: false, error: `Wrong recipient: expected ${this.config.expectedPayTo}, got ${to}` };
    }

    // Check token
    if (tokenMaster !== this.config.expectedToken) {
      return { valid: false, error: `Wrong token: expected ${this.config.expectedToken}, got ${tokenMaster}` };
    }

    // Check amount (string comparison for bigint-safe)
    if (BigInt(amount) < BigInt(this.config.minAmount)) {
      return { valid: false, error: `Insufficient amount: need ${this.config.minAmount}, got ${amount}` };
    }

    // Check signed messages exist
    if (!signedMessages || signedMessages.length === 0) {
      return { valid: false, error: "No signed messages in payload" };
    }

    return { valid: true };
  }

  /**
   * Settle a payment on-chain via TONAPI gasless/send.
   * The signed W5 message is submitted to the relay which broadcasts it.
   */
  async settle(payload: TonPaymentPayload & { _settlementBoc?: string; _walletPublicKey?: string }): Promise<PaymentResponse> {
    // First verify
    const verification = this.verify(payload);
    if (!verification.valid) {
      return { success: false, error: verification.error };
    }

    try {
      // The client provides the full signed external message BOC
      // and their public key for TONAPI gasless/send
      const boc = (payload as any)._settlementBoc;
      const walletPublicKey = (payload as any)._walletPublicKey;

      if (!boc || !walletPublicKey) {
        return { success: false, error: "Missing _settlementBoc or _walletPublicKey in payload" };
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.config.tonapiKey) {
        headers["Authorization"] = `Bearer ${this.config.tonapiKey}`;
      }

      const response = await fetch(`${TONAPI_BASE}/v2/gasless/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          wallet_public_key: walletPublicKey,
          boc: boc,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `TONAPI gasless/send: ${response.status} ${error}` };
      }

      // Mark nonce as used
      this.settledNonces.add(payload.payload.nonce);

      return {
        success: true,
        network: payload.network,
        txHash: `gasless-${payload.payload.nonce.slice(0, 8)}`,
      };
    } catch (err: any) {
      return { success: false, error: `Settlement failed: ${err.message}` };
    }
  }

  /**
   * Get TONAPI gasless config (supported tokens, relay address).
   */
  async getGaslessConfig(): Promise<any> {
    const headers: Record<string, string> = {};
    if (this.config.tonapiKey) {
      headers["Authorization"] = `Bearer ${this.config.tonapiKey}`;
    }

    const response = await fetch(`${TONAPI_BASE}/v2/gasless/config`, { headers });
    if (!response.ok) {
      throw new Error(`TONAPI gasless/config failed: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Get gasless estimate for a jetton transfer.
   * Returns SignRawParams that the client needs to sign.
   */
  async estimateGasless(
    walletAddress: string,
    jettonMaster: string,
    messages: Array<{ address: string; amount: string; payload: string }>
  ): Promise<any> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.tonapiKey) {
      headers["Authorization"] = `Bearer ${this.config.tonapiKey}`;
    }

    const response = await fetch(`${TONAPI_BASE}/v2/gasless/estimate/${jettonMaster}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        wallet_address: walletAddress,
        wallet_public_key: "", // Client fills this
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`TONAPI gasless/estimate failed: ${response.status} ${error}`);
    }
    return response.json();
  }
}

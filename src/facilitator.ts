/**
 * Facilitator HTTP Client — calls the external TON facilitator service.
 *
 * The facilitator handles all blockchain interaction:
 * - /prepare: returns seqno + messages for client signing
 * - /verify: validates signed payment BoC
 * - /settle: relays payment on-chain via self-relay (sponsors gas)
 */

import { TonPaymentPayload, PaymentResponse, PrepareResponse, PaymentOption } from "./types.js";

export interface FacilitatorConfig {
  /** Base URL of the facilitator service */
  facilitatorUrl: string;
}

export class TonFacilitator {
  private config: FacilitatorConfig;
  private verifiedNonces = new Set<string>();

  constructor(config: FacilitatorConfig) {
    this.config = config;
  }

  /**
   * Prepare signing data for a client.
   * Returns seqno, messages, and validUntil — everything needed to sign.
   */
  async prepare(
    walletAddress: string,
    walletPublicKey: string,
    paymentRequirements: PaymentOption,
  ): Promise<PrepareResponse> {
    const response = await fetch(`${this.config.facilitatorUrl}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        walletPublicKey,
        paymentRequirements: {
          scheme: paymentRequirements.scheme,
          network: paymentRequirements.network,
          amount: paymentRequirements.amount,
          payTo: paymentRequirements.payTo,
          asset: paymentRequirements.asset,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Facilitator /prepare failed: ${response.status} ${error}`);
    }
    return response.json();
  }

  /**
   * Verify a payment payload via the facilitator.
   */
  async verify(
    payload: TonPaymentPayload,
    requirements: PaymentOption,
  ): Promise<{ valid: boolean; error?: string }> {
    // Local replay check
    if (this.verifiedNonces.has(payload.payload.nonce)) {
      return { valid: false, error: "Nonce already used (replay)" };
    }

    // Local expiry check
    if (payload.payload.validUntil < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: "Payment expired" };
    }

    const response = await fetch(`${this.config.facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: {
          scheme: requirements.scheme,
          network: requirements.network,
          amount: requirements.amount,
          payTo: requirements.payTo,
          asset: requirements.asset,
        },
      }),
    });

    const result = await response.json();

    if (result.is_valid) {
      return { valid: true };
    }
    return { valid: false, error: result.invalid_reason || "Verification failed" };
  }

  /**
   * Settle a payment on-chain via the facilitator's self-relay.
   */
  async settle(
    payload: TonPaymentPayload,
    requirements: PaymentOption,
  ): Promise<PaymentResponse> {
    const response = await fetch(`${this.config.facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: {
          scheme: requirements.scheme,
          network: requirements.network,
          amount: requirements.amount,
          payTo: requirements.payTo,
          asset: requirements.asset,
        },
      }),
    });

    const result = await response.json();

    if (result.success) {
      this.verifiedNonces.add(payload.payload.nonce);
      return {
        success: true,
        txHash: result.transaction,
        network: result.network,
      };
    }

    return {
      success: false,
      error: result.error_reason || "Settlement failed",
    };
  }
}

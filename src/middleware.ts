/**
 * x402 Payment Middleware for Express + TON.
 *
 * Intercepts requests to protected routes:
 * - No payment header → returns 402 with PaymentRequired
 * - Has payment header → verifies via TonFacilitator → serves resource or returns error
 */

import type { Request, Response, NextFunction } from "express";
import {
  PaymentRequired,
  PaymentOption,
  TonPaymentPayload,
  PaymentResponse,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
} from "./types.js";
import { TonFacilitator } from "./facilitator.js";

export interface ProtectedRoute {
  /** Accepted payment options */
  accepts: PaymentOption[];
  /** Human-readable description of the resource */
  description?: string;
}

export interface MiddlewareConfig {
  /** Map of "METHOD /path" -> payment requirements */
  routes: Record<string, ProtectedRoute>;
  /** TON Facilitator instance */
  facilitator: TonFacilitator;
}

/**
 * Creates Express middleware that enforces x402 payments on configured routes.
 */
export function paymentMiddleware(config: MiddlewareConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const routeKey = `${req.method} ${req.path}`;
    const routeConfig = config.routes[routeKey];

    // Not a protected route — pass through
    if (!routeConfig) {
      return next();
    }

    // Check for payment header
    const paymentHeader = req.headers[HEADER_PAYMENT_SIGNATURE.toLowerCase()] as string | undefined;

    if (!paymentHeader) {
      // No payment — return 402
      const paymentRequired: PaymentRequired = {
        x402Version: 1,
        accepts: routeConfig.accepts,
        error: "Payment required to access this resource",
      };

      const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
      res.setHeader(HEADER_PAYMENT_REQUIRED, encoded);
      res.status(402).json({
        error: "Payment Required",
        message: routeConfig.description || "This resource requires payment",
        x402: paymentRequired,
      });
      return;
    }

    // Parse payment payload
    let payload: TonPaymentPayload;
    try {
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
      payload = JSON.parse(decoded);
    } catch {
      res.status(400).json({ error: "Invalid payment payload" });
      return;
    }

    // Verify payment
    const verification = config.facilitator.verify(payload);
    if (!verification.valid) {
      const response: PaymentResponse = {
        success: false,
        error: verification.error,
      };
      const encoded = Buffer.from(JSON.stringify(response)).toString("base64");
      res.setHeader(HEADER_PAYMENT_RESPONSE, encoded);
      res.status(402).json({
        error: "Payment verification failed",
        details: verification.error,
      });
      return;
    }

    // Settle payment on-chain
    const settlement = await config.facilitator.settle(payload);

    const responseEncoded = Buffer.from(JSON.stringify(settlement)).toString("base64");
    res.setHeader(HEADER_PAYMENT_RESPONSE, responseEncoded);

    if (!settlement.success) {
      res.status(402).json({
        error: "Payment settlement failed",
        details: settlement.error,
      });
      return;
    }

    // Payment successful — continue to route handler
    next();
  };
}

/**
 * x402 Payment Middleware for Express + TON.
 *
 * Intercepts requests to protected routes:
 * - No payment header → returns 402 with PaymentRequired
 * - Has payment header → verifies + settles via facilitator → serves resource
 */

import type { Request, Response, NextFunction } from "express";
import {
  PaymentRequired,
  PaymentOption,
  TonPaymentPayload,
  PaymentResponse,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT,
  HEADER_PAYMENT_RESPONSE,
} from "./types.js";
import { TonFacilitator } from "./facilitator.js";

export interface ProtectedRoute {
  accepts: PaymentOption[];
  description?: string;
}

export interface MiddlewareConfig {
  routes: Record<string, ProtectedRoute>;
  facilitator: TonFacilitator;
}

export function paymentMiddleware(config: MiddlewareConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const routeKey = `${req.method} ${req.path}`;
    const routeConfig = config.routes[routeKey];

    if (!routeConfig) {
      return next();
    }

    const paymentHeader = req.headers[HEADER_PAYMENT.toLowerCase()] as string | undefined;

    if (!paymentHeader) {
      const paymentRequired: PaymentRequired = {
        x402Version: 2,
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

    let payload: TonPaymentPayload;
    try {
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
      payload = JSON.parse(decoded);
    } catch {
      res.status(400).json({ error: "Invalid payment payload" });
      return;
    }

    const requirements = routeConfig.accepts[0];

    // Verify via facilitator (required)
    const verification = await config.facilitator.verify(payload, requirements);
    if (!verification.valid) {
      const response: PaymentResponse = { success: false, error: verification.error };
      const encoded = Buffer.from(JSON.stringify(response)).toString("base64");
      res.setHeader(HEADER_PAYMENT_RESPONSE, encoded);
      res.status(402).json({ error: "Payment verification failed", details: verification.error });
      return;
    }

    // Settle via facilitator (self-relay)
    const settlement = await config.facilitator.settle(payload, requirements);
    const responseEncoded = Buffer.from(JSON.stringify(settlement)).toString("base64");
    res.setHeader(HEADER_PAYMENT_RESPONSE, responseEncoded);

    if (!settlement.success) {
      res.status(402).json({ error: "Payment settlement failed", details: settlement.error });
      return;
    }

    next();
  };
}

// The 402 Payment Required flow (x402-style machine payments).
//
// Two phases:
//   1. Challenge — no valid payment on the request → return 402 with a body
//      describing price + accepted payment networks/facilitators. A compatible
//      agent runtime reads this, constructs a signed payment authorization, and
//      retries with an `X-PAYMENT` header.
//   2. Settle — request carries `X-PAYMENT` → verify the authorization, hand
//      settlement to a facilitator, and on success let the request proceed to
//      origin (caller serves 200 + content).
//
// The facilitator/verification here is a stub. Wire it to a real x402
// facilitator or your own settlement service.

const PAYMENT_HEADER = "x-payment";

// Build the 402 challenge for a given price.
export function challenge402(url, priceUsd, env) {
  const body = {
    x402Version: 1,
    error: "payment_required",
    accepts: [
      {
        scheme: "exact",
        network: env?.PAYMENT_NETWORK || "base-sepolia",
        maxAmountRequired: String(Math.round(priceUsd * 1e6)), // 6-dp units
        asset: "USDC",
        resource: url.toString(),
        description: `Access to ${url.pathname}`,
        payTo: env?.PAYOUT_ADDRESS || "0xYOUR_PAYOUT_ADDRESS",
        facilitator: env?.FACILITATOR_URL || "https://facilitator.example/verify",
        maxTimeoutSeconds: 60,
      },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 402,
    headers: {
      "content-type": "application/json",
      // Advertise the price on headers too, for simple clients.
      "x-price-usd": String(priceUsd),
      "accept-payment": "x402",
    },
  });
}

// Verify a submitted payment authorization. Returns { ok, receipt? , reason? }.
async function verifyPayment(paymentToken, url, priceUsd, env) {
  // Real flow: POST the signed authorization to the facilitator, which checks
  // signature, amount, asset, recipient, and freshness, then settles on-chain.
  //
  // const res = await fetch(`${env.FACILITATOR_URL}/verify`, {
  //   method: "POST",
  //   headers: { "content-type": "application/json" },
  //   body: JSON.stringify({ payment: paymentToken, resource: url.toString(),
  //                          amount: priceUsd }),
  // });
  // return res.ok ? { ok: true, receipt: (await res.json()).receipt }
  //               : { ok: false, reason: "facilitator-rejected" };

  // Stub: accept a non-empty token in dev so the flow is exercisable.
  if (paymentToken && paymentToken.length > 8) {
    return { ok: true, receipt: `dev-receipt-${Date.now()}` };
  }
  return { ok: false, reason: "invalid-or-missing-authorization" };
}

/**
 * Gate a monetized request.
 * @returns { paid: true, receipt } to let it through, or
 *          { paid: false, response } — a 402 (or 402-with-error) to return.
 */
export async function requirePayment(request, url, priceUsd, env) {
  const token = request.headers.get(PAYMENT_HEADER);

  if (!token) {
    return { paid: false, response: challenge402(url, priceUsd, env) };
  }

  const result = await verifyPayment(token, url, priceUsd, env);
  if (result.ok) {
    return { paid: true, receipt: result.receipt };
  }

  // Bad payment → re-challenge with the reason.
  const resp = challenge402(url, priceUsd, env);
  resp.headers.set("x-payment-error", result.reason);
  return { paid: false, response: resp };
}

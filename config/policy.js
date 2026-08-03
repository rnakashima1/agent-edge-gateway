// Per-path business rules — the "page-level business rules layer."
//
// Rules are evaluated top to bottom; first matching `test` wins. Each rule
// declares, per intent, what to do with a *verified* agent:
//   "pass"     serve the normal origin response
//   "optimize" serve the AI-optimized variant (transform.js)
//   "block"    403 deny
//   "monetize" 402 Payment Required (payment.js), with a price
//
// Two layers of specificity, resolved by policyFor():
//   1. `rules`     — per-intent defaults for the path (applies to every lab)
//   2. `perVendor` — per-frontier-lab overrides, keyed by vendor slug
//                    (see VENDORS in agents.js), then by intent
//
// A perVendor[vendor][intent] entry wins over rules[intent]. This is what lets
// OpenAI, Anthropic, Perplexity, Google, etc. each get different treatment on
// the same page — e.g. give a licensing partner cheaper (or free) access while
// charging or blocking a lab you have no deal with.
//
// Unverified agents claiming a known UA are downgraded one step (monetize ->
// block, optimize -> block) in decide.js, because you can't bill or trust an
// identity you couldn't verify.

export const POLICY = [
  {
    // Premium / paywalled content: charge live-search + indexing agents,
    // block bulk training scrapers outright — then override per lab.
    test: (url) => url.pathname.startsWith("/premium/"),
    rules: {
      training: { action: "block" },
      indexing: { action: "monetize", priceUsd: 0.02 },
      live_search: { action: "monetize", priceUsd: 0.05 },
    },
    perVendor: {
      // Licensing partner: allow training at a negotiated rate, premium
      // live-search still billed but at the partner rate.
      anthropic: {
        training: { action: "monetize", priceUsd: 0.008 },
        live_search: { action: "monetize", priceUsd: 0.03 },
      },
      // No deal in place: charge OpenAI a premium for live answers.
      openai: {
        live_search: { action: "monetize", priceUsd: 0.08 },
      },
      // Perplexity drives referral clicks — let it index premium, still bill
      // live answers at a modest rate.
      perplexity: {
        indexing: { action: "optimize" },
        live_search: { action: "monetize", priceUsd: 0.04 },
      },
    },
  },
  {
    // Public articles: let indexing + live-search agents in on the optimized
    // variant (you *want* to be cited), monetize training corpora — per lab.
    test: (url) => url.pathname.startsWith("/article/"),
    rules: {
      training: { action: "monetize", priceUsd: 0.01 },
      indexing: { action: "optimize" },
      live_search: { action: "optimize" },
    },
    perVendor: {
      // Partner: training is free/optimized under the license agreement.
      anthropic: {
        training: { action: "optimize" },
      },
      // No training deal: block OpenAI training crawl, but welcome its
      // live-search agent (drives attributed traffic).
      openai: {
        training: { action: "block" },
      },
      // ByteDance / Bytespider: block outright regardless of intent.
      bytedance: {
        training: { action: "block" },
        indexing: { action: "block" },
        live_search: { action: "block" },
      },
    },
  },
  {
    // Default: everything else passes through untouched.
    test: () => true,
    rules: {
      training: { action: "pass" },
      indexing: { action: "pass" },
      live_search: { action: "pass" },
    },
  },
];

/**
 * Resolve the action for a request.
 * @param url    URL object
 * @param intent "training" | "indexing" | "live_search"
 * @param vendor frontier-lab slug (agents.js `vendor`), or undefined
 */
export function policyFor(url, intent, vendor) {
  const rule = POLICY.find((r) => r.test(url));

  // Per-vendor override wins when present for this vendor + intent.
  const vendorRules = rule.perVendor && rule.perVendor[vendor];
  if (vendorRules && vendorRules[intent]) {
    return { ...vendorRules[intent], vendor, source: "vendor" };
  }

  // Otherwise fall back to the path-level default for this intent.
  const base = (rule.rules && rule.rules[intent]) || { action: "pass" };
  return { ...base, vendor, source: "default" };
}

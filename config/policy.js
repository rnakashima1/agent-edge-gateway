// Per-path business rules — the "page-level business rules layer."
//
// Rules are evaluated top to bottom; first matching `test` wins. Each rule
// declares, per intent, what to do with a *verified* agent:
//   "pass"     serve the normal origin response
//   "optimize" serve the AI-optimized variant (transform.js)
//   "block"    403 deny
//   "monetize" 402 Payment Required (payment.js), with a price
//
// Unverified agents claiming a known UA are downgraded one step (monetize ->
// block, optimize -> block) in decide.js, because you can't bill or trust an
// identity you couldn't verify.

export const POLICY = [
  {
    // Premium / paywalled content: charge live-search + indexing agents,
    // block bulk training scrapers outright.
    test: (url) => url.pathname.startsWith("/premium/"),
    rules: {
      training: { action: "block" },
      indexing: { action: "monetize", priceUsd: 0.02 },
      live_search: { action: "monetize", priceUsd: 0.05 },
    },
  },
  {
    // Public articles: let indexing + live-search agents in on the optimized
    // variant (you *want* to be cited), monetize training corpora.
    test: (url) => url.pathname.startsWith("/article/"),
    rules: {
      training: { action: "monetize", priceUsd: 0.01 },
      indexing: { action: "optimize" },
      live_search: { action: "optimize" },
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

export function policyFor(url, intent) {
  const rule = POLICY.find((r) => r.test(url));
  return rule.rules[intent] || { action: "pass" };
}

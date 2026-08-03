// Business-rules model: a single site-wide matrix of per-vendor decisions.
//
// (Earlier versions split traffic into path "zones" like /premium vs /article.
// The target sites — localnewsmatters.org, mendovoice.com — have no such
// structure, so policy is now flat: one set of defaults for all labs, plus
// per-frontier-lab overrides. Reintroduce zones later if a site needs them.)
//
// The policy doc is plain JSON so it can live in KV and be edited from the
// admin UI without a redeploy:
//
//   {
//     version, updatedAt,
//     defaults: { live_search, indexing, training },   // applies to all labs
//     vendors:  { <vendorSlug>: { live_search?, indexing?, training? } }
//   }
//
// Each cell is a decision: { action, priceUsd? }
//   action: "pass" | "optimize" | "block" | "monetize"  (price only for monetize)
//
// Resolution (resolve()): a vendor override for the intent wins; otherwise the
// site default for the intent; otherwise pass.

export const INTENTS = ["live_search", "indexing", "training"];
export const INTENT_LABELS = {
  live_search: "AI Live Search",
  indexing: "AI Indexing",
  training: "AI Training",
};
export const ACTIONS = ["pass", "optimize", "block", "monetize"];

// Seed / fallback config. A local-news site generally *wants* to be cited by
// answer engines and live-search agents (optimize), while charging bulk
// training crawlers. Edit via the admin UI once KV is populated.
export const DEFAULT_POLICY_DOC = {
  version: 3,
  updatedAt: null,
  defaults: {
    live_search: { action: "optimize" },
    indexing: { action: "optimize" },
    training: { action: "monetize", priceUsd: 0.01 },
  },
  vendors: {
    // Example override: block ByteDance/Bytespider outright. Everything else
    // inherits the defaults above until you set per-lab rules in the editor.
    bytedance: {
      live_search: { action: "block" },
      indexing: { action: "block" },
      training: { action: "block" },
    },
  },
};

/**
 * Resolve a decision from a (possibly KV-loaded) policy doc.
 * @param doc    policy doc (DEFAULT_POLICY_DOC shape)
 * @param vendor frontier-lab slug, or undefined
 * @param intent "live_search" | "indexing" | "training"
 */
export function resolve(doc, vendor, intent) {
  const vendorRule =
    doc && doc.vendors && doc.vendors[vendor] && doc.vendors[vendor][intent];
  if (vendorRule) return { ...vendorRule, vendor, source: "vendor" };

  const base = (doc && doc.defaults && doc.defaults[intent]) || { action: "pass" };
  return { ...base, vendor, source: "default" };
}

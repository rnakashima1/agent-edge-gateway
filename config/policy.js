// Business-rules model, now split into:
//   - ZONES: which paths map to which named policy zone (structural, in code)
//   - DEFAULT_POLICY_DOC: the editable pricing/action config (the *seed* + the
//     fallback used when KV is empty or unreachable). At runtime this is
//     overlaid by whatever is stored in KV — see src/config-store.js.
//
// A policy doc is a plain JSON object so it can live in KV and be edited from
// the admin UI without a redeploy:
//
//   {
//     version, updatedAt,
//     zones: {
//       <zoneName>: {
//         label,
//         defaults: { live_search, indexing, training },   // applies to all labs
//         vendors:  { <vendorSlug>: { live_search?, indexing?, training? } }
//       }
//     }
//   }
//
// Each cell is a decision: { action, priceUsd? }
//   action: "pass" | "optimize" | "block" | "monetize"  (price only for monetize)
//
// Resolution (resolve()): vendor override for the intent wins; otherwise the
// zone default for the intent; otherwise pass.

export const INTENTS = ["live_search", "indexing", "training"];
export const INTENT_LABELS = {
  live_search: "AI Live Search",
  indexing: "AI Indexing",
  training: "AI Training",
};
export const ACTIONS = ["pass", "optimize", "block", "monetize"];

// Path → zone mapping. First match wins. Kept in code (structural), not KV.
export const ZONES = [
  {
    name: "premium",
    label: "Premium / paywalled  (/premium/*)",
    test: (url) => url.pathname.startsWith("/premium/"),
  },
  {
    name: "article",
    label: "Public articles  (/article/*)",
    test: (url) => url.pathname.startsWith("/article/"),
  },
  {
    name: "default",
    label: "Everything else",
    test: () => true,
  },
];

export function zoneNameFor(url) {
  return (ZONES.find((z) => z.test(url)) || ZONES[ZONES.length - 1]).name;
}

// Seed / fallback pricing. Edit via the admin UI once KV is populated; this is
// what a fresh deployment starts from.
export const DEFAULT_POLICY_DOC = {
  version: 2,
  updatedAt: null,
  zones: {
    premium: {
      label: "Premium / paywalled  (/premium/*)",
      defaults: {
        live_search: { action: "monetize", priceUsd: 0.05 },
        indexing: { action: "monetize", priceUsd: 0.02 },
        training: { action: "block" },
      },
      vendors: {
        anthropic: {
          live_search: { action: "monetize", priceUsd: 0.03 },
          training: { action: "monetize", priceUsd: 0.008 },
        },
        openai: {
          live_search: { action: "monetize", priceUsd: 0.08 },
        },
        perplexity: {
          indexing: { action: "optimize" },
          live_search: { action: "monetize", priceUsd: 0.04 },
        },
      },
    },
    article: {
      label: "Public articles  (/article/*)",
      defaults: {
        live_search: { action: "optimize" },
        indexing: { action: "optimize" },
        training: { action: "monetize", priceUsd: 0.01 },
      },
      vendors: {
        anthropic: { training: { action: "optimize" } },
        openai: { training: { action: "block" } },
        bytedance: {
          training: { action: "block" },
          indexing: { action: "block" },
          live_search: { action: "block" },
        },
      },
    },
    default: {
      label: "Everything else",
      defaults: {
        live_search: { action: "pass" },
        indexing: { action: "pass" },
        training: { action: "pass" },
      },
      vendors: {},
    },
  },
};

/**
 * Resolve a decision from a (possibly KV-loaded) policy doc.
 * @param doc      policy doc (DEFAULT_POLICY_DOC shape)
 * @param zoneName from zoneNameFor(url)
 * @param vendor   frontier-lab slug, or undefined
 * @param intent   "live_search" | "indexing" | "training"
 */
export function resolve(doc, zoneName, vendor, intent) {
  const zone = (doc && doc.zones && doc.zones[zoneName]) || {};
  const vendorRule = zone.vendors && zone.vendors[vendor] && zone.vendors[vendor][intent];
  if (vendorRule) return { ...vendorRule, vendor, source: "vendor" };

  const base = (zone.defaults && zone.defaults[intent]) || { action: "pass" };
  return { ...base, vendor, source: "default" };
}

// KV-backed policy config store.
//
// The pricing/action matrix lives in a Cloudflare KV namespace (binding
// POLICY_KV) so it can be edited from the admin UI without redeploying. If KV
// is unbound, empty, or holds an invalid doc, we fall back to
// DEFAULT_POLICY_DOC from config/policy.js.
//
// A tiny in-isolate cache avoids a KV read on every request. KV is eventually
// consistent and each isolate caches independently, so a save can take up to
// CACHE_TTL_MS to be visible everywhere; a save busts the local cache
// immediately.

import {
  DEFAULT_POLICY_DOC,
  INTENTS,
  ACTIONS,
} from "../config/policy.js";

const KV_KEY = "policy:current";
const CACHE_TTL_MS = 10_000;

let cache = { doc: null, at: 0 };

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// Validate + normalize a single decision cell.
function validateCell(cell, where, errors) {
  if (!isPlainObject(cell)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  if (!ACTIONS.includes(cell.action)) {
    errors.push(`${where}: action must be one of ${ACTIONS.join("|")}`);
    return null;
  }
  const out = { action: cell.action };
  if (cell.action === "monetize") {
    const p = Number(cell.priceUsd);
    if (!Number.isFinite(p) || p < 0) {
      errors.push(`${where}: monetize requires priceUsd >= 0`);
      return null;
    }
    out.priceUsd = Math.round(p * 1e6) / 1e6; // clamp to 6dp (USDC precision)
  }
  return out;
}

function validateIntentMap(map, where, errors, { requireAll }) {
  if (!isPlainObject(map)) {
    errors.push(`${where}: must be an object`);
    return {};
  }
  const out = {};
  for (const intent of INTENTS) {
    if (map[intent] == null) {
      if (requireAll) errors.push(`${where}: missing "${intent}"`);
      continue;
    }
    const cell = validateCell(map[intent], `${where}.${intent}`, errors);
    if (cell) out[intent] = cell;
  }
  // Reject unknown intent keys so typos surface instead of silently no-op'ing.
  for (const k of Object.keys(map)) {
    if (!INTENTS.includes(k)) errors.push(`${where}: unknown intent "${k}"`);
  }
  return out;
}

/**
 * Validate a full policy doc. Returns { ok, doc?, errors }.
 * Only structural validity is enforced — vendor slugs are free-form so new
 * labs can be added without a code change.
 */
export function validatePolicyDoc(input) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ["doc must be an object"] };
  if (!isPlainObject(input.zones)) return { ok: false, errors: ["doc.zones must be an object"] };

  const zones = {};
  for (const [zoneName, zone] of Object.entries(input.zones)) {
    if (!isPlainObject(zone)) {
      errors.push(`zones.${zoneName}: must be an object`);
      continue;
    }
    const defaults = validateIntentMap(
      zone.defaults || {},
      `zones.${zoneName}.defaults`,
      errors,
      { requireAll: true }
    );
    const vendors = {};
    if (zone.vendors != null) {
      if (!isPlainObject(zone.vendors)) {
        errors.push(`zones.${zoneName}.vendors: must be an object`);
      } else {
        for (const [vendor, vmap] of Object.entries(zone.vendors)) {
          const cells = validateIntentMap(
            vmap,
            `zones.${zoneName}.vendors.${vendor}`,
            errors,
            { requireAll: false }
          );
          if (Object.keys(cells).length) vendors[vendor] = cells;
        }
      }
    }
    zones[zoneName] = {
      label: typeof zone.label === "string" ? zone.label : zoneName,
      defaults,
      vendors,
    };
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    doc: {
      version: Number(input.version) || DEFAULT_POLICY_DOC.version,
      updatedAt: input.updatedAt || null,
      zones,
    },
  };
}

/** Load the active policy doc (cached), falling back to the seed. */
export async function getPolicyDoc(env) {
  const now = Date.now();
  if (cache.doc && now - cache.at < CACHE_TTL_MS) return cache.doc;

  let doc = DEFAULT_POLICY_DOC;
  try {
    if (env && env.POLICY_KV) {
      const stored = await env.POLICY_KV.get(KV_KEY, "json");
      if (stored) {
        const v = validatePolicyDoc(stored);
        if (v.ok) doc = v.doc;
        else console.warn("policy KV invalid, using default:", v.errors.join("; "));
      }
    }
  } catch (e) {
    console.warn("policy KV read failed, using default:", e && e.message);
  }

  cache = { doc, at: now };
  return doc;
}

/** Persist a new policy doc. Returns { ok, doc? , errors }. */
export async function putPolicyDoc(env, input) {
  const v = validatePolicyDoc(input);
  if (!v.ok) return v;

  v.doc.updatedAt = new Date().toISOString();
  if (!env || !env.POLICY_KV) {
    return { ok: false, errors: ["POLICY_KV binding not configured"] };
  }
  await env.POLICY_KV.put(KV_KEY, JSON.stringify(v.doc));
  cache = { doc: v.doc, at: Date.now() }; // bust local cache immediately
  return { ok: true, errors: [], doc: v.doc };
}

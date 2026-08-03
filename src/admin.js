// Admin surface: the policy editor UI + its JSON API.
//
// Routes (all under /__policy):
//   GET  /__policy or /__policy/ui   → HTML editor (no token; shell only)
//   GET  /__policy/api/meta          → vendor/intent/action metadata
//   GET  /__policy/api/config        → current policy doc (from KV or seed)
//   PUT  /__policy/api/config        → validate + save policy doc to KV
//
// The API routes require a bearer token equal to env.ADMIN_TOKEN. If
// ADMIN_TOKEN is unset the API is disabled (503) — set it as a Worker secret
// (`wrangler secret put ADMIN_TOKEN`) or in .dev.vars for local dev.

import { adminUiHtml } from "./admin-ui.js";
import { getPolicyDoc, putPolicyDoc } from "./config-store.js";
import { INTENTS, INTENT_LABELS, ACTIONS } from "../config/policy.js";
import { VENDORS } from "../config/agents.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function bearer(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-admin-token") || "";
}

// Length-independent-ish comparison to avoid trivial timing leaks.
function tokenOk(provided, expected) {
  if (!expected) return false;
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function meta() {
  const vendorList = Object.keys(VENDORS)
    .filter((slug) => slug !== "default")
    .map((slug) => ({ slug, label: VENDORS[slug] }));
  return {
    vendorList,
    intents: INTENTS,
    intentLabels: INTENT_LABELS,
    actions: ACTIONS,
  };
}

export async function handleAdmin(request, url, env) {
  const path = url.pathname;

  // UI shell — safe to serve unauthenticated; all data access is token-gated.
  if (path === "/__policy" || path === "/__policy/ui") {
    return new Response(adminUiHtml(), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // Everything else is API and requires the token.
  if (!env || !env.ADMIN_TOKEN) {
    return json({ error: "admin API disabled: ADMIN_TOKEN not set" }, 503);
  }
  if (!tokenOk(bearer(request), env.ADMIN_TOKEN)) {
    return json({ error: "unauthorized" }, 401);
  }

  if (path === "/__policy/api/meta" && request.method === "GET") {
    return json(meta());
  }

  if (path === "/__policy/api/config") {
    if (request.method === "GET") {
      return json(await getPolicyDoc(env));
    }
    if (request.method === "PUT") {
      let input;
      try {
        input = await request.json();
      } catch {
        return json({ errors: ["body is not valid JSON"] }, 400);
      }
      const result = await putPolicyDoc(env, input);
      if (!result.ok) return json({ errors: result.errors }, 400);
      return json({ ok: true, doc: result.doc });
    }
    return json({ error: "method not allowed" }, 405);
  }

  return json({ error: "not found" }, 404);
}

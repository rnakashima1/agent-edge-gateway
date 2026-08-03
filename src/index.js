// Worker entry point: orchestrate detect → decide → fork.
//
//   fetch(request) →
//     classify(request)                     (detect.js)
//     decide(classification, url)           (decide.js)
//     switch (action):
//       pass     → origin response, untouched
//       optimize → AI-optimized variant     (transform.js)
//       block    → 403
//       monetize → 402 → verify → origin     (payment.js)

import { classify } from "./detect.js";
import { decide } from "./decide.js";
import { toAgentVariant } from "./transform.js";
import { requirePayment } from "./payment.js";
import { getPolicyDoc } from "./config-store.js";
import { handleAdmin } from "./admin.js";

// Replace with your real origin (or a service binding). For local dev this
// echoes a tiny sample page so the fork is observable without a backend.
async function fetchOrigin(request, env) {
  if (env?.ORIGIN_URL) {
    const target = new URL(request.url);
    const origin = new URL(env.ORIGIN_URL);
    target.protocol = origin.protocol;
    target.host = origin.host;
    return fetch(new Request(target, request));
  }
  const url = new URL(request.url);
  return new Response(
    `<!doctype html><html><head><title>Sample: ${url.pathname}</title></head>
<body>
<nav>site nav — ads — cookie banner</nav>
<main><article><h1>Sample article at ${url.pathname}</h1>
<p>This is the human page. An allowed agent gets a stripped, structured variant of this same content.</p>
</article></main>
<footer>footer junk</footer>
</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function logDecision(url, cls, action) {
  // Ship this to your analytics pipeline (the dashboard's traffic/revenue
  // numbers come from here). console in dev.
  console.log(
    JSON.stringify({
      t: Date.now(),
      path: url.pathname,
      kind: cls.kind,
      agent: cls.agent?.name || null,
      vendor: cls.agent?.vendor || null,
      verified: cls.verified,
      intent: cls.intent,
      action: action.action,
      reason: action.reason,
      signals: cls.signals,
    })
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Admin surface (policy editor + API). Handled before classification so it
    // is never bot-forked or monetized; it is token-gated in admin.js.
    if (url.pathname === "/__policy" || url.pathname.startsWith("/__policy/")) {
      return handleAdmin(request, url, env);
    }

    const policyDoc = await getPolicyDoc(env);
    const cls = await classify(request, env);
    const action = decide(cls, url, policyDoc);
    logDecision(url, cls, action);

    switch (action.action) {
      case "block":
        return new Response("Automated access to this resource is not permitted.", {
          status: 403,
          headers: { "content-type": "text/plain", "x-deny-reason": action.reason },
        });

      case "monetize": {
        const gate = await requirePayment(request, url, action.priceUsd, env);
        if (!gate.paid) return gate.response; // 402
        const origin = await fetchOrigin(request, env);
        const variant = await toAgentVariant(origin, {
          url,
          intent: cls.intent,
          agentName: cls.agent?.name || "agent",
          licenseUrl: env?.LICENSE_URL,
        });
        variant.headers.set("x-payment-receipt", gate.receipt);
        return variant;
      }

      case "optimize": {
        const origin = await fetchOrigin(request, env);
        return toAgentVariant(origin, {
          url,
          intent: cls.intent,
          agentName: cls.agent?.name || "agent",
          licenseUrl: env?.LICENSE_URL,
        });
      }

      case "pass":
      default:
        return fetchOrigin(request, env);
    }
  },
};

# agent-edge-gateway

A reference implementation of an **edge-layer AI-agent gateway**: detect AI
crawlers/agents at the CDN edge, decide a policy per request, and **fork the
response** — serve humans the normal page, serve allowed agents a clean
AI-optimized representation, block unwanted bots, or return **HTTP `402 Payment
Required`** to monetized agents using the [x402](https://x402.org) machine
payment flow.

This is the same architecture behind Cloudflare's pay-per-crawl / Monetization
Gateway and AWS WAF's "AI traffic monetization" feature. It runs as a
**Cloudflare Worker** (the pattern ports directly to CloudFront + Lambda@Edge,
Fastly Compute, or Akamai EdgeWorkers).

> ⚠️ **Read this first — cloaking.** Serving crawlers different content than
> humans is technically *cloaking*, the same mechanism used for black-hat SEO.
> The legitimate line: the agent variant must be a **faithful, format-shifted
> representation of the same content** (clean HTML / JSON-LD / Markdown), never
> different *facts*. Serving bots substantially different claims than users is
> deception and can get you penalized. Keep the transform honest.

## Request lifecycle

```
Request → [edge worker]
            1. fingerprint & classify   (src/detect.js, src/fingerprint.js)
            2. decide policy             (src/decide.js)
            3. fork response:
               ├─ human          → pass through to origin
               ├─ allowed agent  → AI-optimized variant (src/transform.js)
               ├─ blocked agent  → 403 deny
               └─ monetized agent→ 402 → verify payment → serve (src/payment.js)
```

## Detection layers (defense in depth)

No single signal is trusted; `src/detect.js` combines them into a score + intent:

| Layer | Signal | File |
|-------|--------|------|
| Declared | `User-Agent` matches a known agent | `config/agents.js` |
| Verified | reverse+forward DNS / published IPs / [Web Bot Auth](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/web-bot-auth/) signature | `src/detect.js` |
| Fingerprint | TLS JA3/JA4, HTTP/2 fingerprint, header coherence | `src/fingerprint.js` |
| Behavioral | cadence, breadth, no asset fetches (out of scope here — needs state) | — |

Intent is bucketed as `training` \| `indexing` \| `live_search`, because you
usually price and treat them differently.

## Per-lab policy (frontier-lab routing)

Every agent is tagged with a `vendor` — the frontier lab / operator behind it
(`openai`, `anthropic`, `perplexity`, `google`, `bytedance`, …; see `VENDORS`
in `config/agents.js`). Policy resolves in two layers (`config/policy.js`):

1. **`rules`** — per-intent defaults for the path (apply to every lab)
2. **`perVendor`** — per-lab overrides, keyed `vendor → intent`

A `perVendor[vendor][intent]` entry wins over the path default; anything not
overridden falls back to the default, so a lab you haven't listed still gets
baseline coverage. This is what lets you treat labs differently on the *same*
page — e.g. give a licensing partner free/cheap access while charging or
blocking a lab you have no deal with:

| Request (`/article/*`, training intent) | Default | Effective |
|------------------------------------------|---------|-----------|
| Anthropic `ClaudeBot` (partner)          | monetize $0.01 | **optimize (free)** |
| OpenAI `GPTBot` (no deal)                 | monetize $0.01 | **block (403)** |
| ByteDance `Bytespider`                    | monetize $0.01 | **block (403)** |
| Google-Extended (unlisted)               | monetize $0.01 | monetize $0.01 |

| Request (`/premium/*`, live_search)      | Default | Effective |
|------------------------------------------|---------|-----------|
| OpenAI `ChatGPT-User`                     | monetize $0.05 | **$0.08** |
| Anthropic `Claude-User` (partner)         | monetize $0.05 | **$0.03** |
| Perplexity `Perplexity-User`              | monetize $0.05 | **$0.04** |

Add or retune a lab by editing the `perVendor` map for the relevant path — no
code changes needed.

## Layout

```
src/
  index.js        Worker entry — orchestrates detect → decide → fork
  detect.js       Classification + confidence + intent
  fingerprint.js  TLS/HTTP fingerprint heuristics from request metadata
  decide.js       Policy engine (allow / optimize / block / monetize)
  transform.js    Builds the AI-optimized response variant
  payment.js      402 challenge + x402 verification (facilitator stub)
  config-store.js KV load/save + validation for the policy doc (seed fallback)
  admin.js        Token-gated policy editor API (/__policy/api/*)
  admin-ui.js     The editor page (served at /__policy/ui)
config/
  agents.js       Agent registry + VENDORS (UA, verify method, vendor, intent)
  policy.js       Zones, the editable policy-doc schema + seed, and resolver
wrangler.toml     Cloudflare Worker config + KV binding
```

## Editable pricing config (KV + admin UI)

The per-vendor pricing/action matrix lives in **Cloudflare KV** (binding
`POLICY_KV`), so you retune it without a redeploy. If KV is empty or
unreachable the Worker falls back to the seed in `DEFAULT_POLICY_DOC`
(`config/policy.js`). Reads are cached in-isolate for ~10s.

Each cell in the matrix is a decision for one **(zone → lab → bucket)**, where
the three buckets are exactly:

- **AI Live Search** — RAG / real-time agent fetches answering a user now
- **AI Indexing** — answer-engine / search crawlers
- **AI Training** — corpus-building crawlers

The **editor** at `/__policy/ui` renders one grid per zone: a *Default (all
labs)* row plus a row per frontier lab, columns for the three buckets, each an
action select (`pass` / `optimize` / `block` / `monetize`) with a USD price
field shown only for `monetize`. Lab rows can be `inherit` (no override → use
the zone default).

### Setup

```bash
# 1. Create the KV namespace and paste the printed ids into wrangler.toml
npx wrangler kv namespace create POLICY_KV
npx wrangler kv namespace create POLICY_KV --preview

# 2. Set the admin token (gates /__policy/api/*)
npx wrangler secret put ADMIN_TOKEN        # production
echo 'ADMIN_TOKEN = "dev-secret-change-me"' > .dev.vars   # local dev (gitignored)

# 3. Run, then open the editor
npx wrangler dev
open http://localhost:8787/__policy/ui
```

### API (bearer `ADMIN_TOKEN`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/__policy/api/meta` | zones, vendor list, intents, actions |
| GET | `/__policy/api/config` | current policy doc |
| PUT | `/__policy/api/config` | validate + save (400 with `errors[]` on bad input) |

```bash
# Read current config
curl -H "authorization: Bearer $ADMIN_TOKEN" localhost:8787/__policy/api/config

# Change a price and save
curl -X PUT -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" --data @policy.json \
  localhost:8787/__policy/api/config
```

The API is disabled (503) until `ADMIN_TOKEN` is set, and the UI shell is the
only unauthenticated route. Invalid docs are rejected (unknown action, negative
price, missing default bucket, unknown intent key), so a bad save can't brick
routing.

## Run locally

```bash
npm install
npx wrangler dev
```

Then exercise it with different identities and diff the responses:

```bash
# human
curl -s http://localhost:8787/article/example | head -20

# declared crawler
curl -s -A "GPTBot/1.0 (+https://openai.com/gptbot)" http://localhost:8787/article/example | head -20

# monetized path → expect 402
curl -si -A "ClaudeBot/1.0" http://localhost:8787/premium/report | head -20
```

## Reverse-engineering someone else's gateway (black-box)

The same script is how you'd probe a live deployment:

1. Curl one URL with varied `User-Agent`s and **diff** status/headers/body.
2. Hold UA constant, vary **TLS fingerprint** (`curl` vs `curl-impersonate`) to
   see if they gate on fingerprint, not just UA.
3. Vary **source ASN** (datacenter vs residential) for IP-reputation gating.
4. Hit a monetized path and inspect the **402 body** for pricing + facilitator.
5. Check `robots.txt`, `/.well-known/`, and `Vary` / `Link` headers for
   declared license terms.

## License

MIT — see [LICENSE](LICENSE). Educational reference; verify legal/SEO
implications before production use.

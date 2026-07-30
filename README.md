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

## Layout

```
src/
  index.js        Worker entry — orchestrates detect → decide → fork
  detect.js       Classification + confidence + intent
  fingerprint.js  TLS/HTTP fingerprint heuristics from request metadata
  decide.js       Policy engine (allow / optimize / block / monetize)
  transform.js    Builds the AI-optimized response variant
  payment.js      402 challenge + x402 verification (facilitator stub)
config/
  agents.js       Known agent registry (UA patterns, verify method, intent)
  policy.js       Per-path business rules
wrangler.toml     Cloudflare Worker config
```

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

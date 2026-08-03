// Known AI agent registry.
//
// `ua` is a case-insensitive substring match against the User-Agent (a *hint*,
// since UA is self-declared and trivially spoofed). `verify` names the method
// detect.js should use to actually trust the identity before charging or
// granting access. `vendor` is the frontier lab / operator behind the agent —
// policy can branch on it, so OpenAI, Anthropic, Perplexity, etc. can each get
// different treatment. `intent` buckets the traffic for policy/pricing.
//
// verify:
//   "rdns"      reverse+forward DNS must resolve to `verifyHosts`
//   "web-bot-auth"  HTTP Message Signature over the request (preferred)
//   "none"      declared only — never enough to monetize, only to soft-classify
//
// vendor: see VENDORS below (the frontier lab / operator slug)
// intent: "training" | "indexing" | "live_search"

// Frontier labs / operators we recognize. The slug is what policy.js keys on.
// `default` is applied to any verified-but-unlisted vendor so new labs get
// baseline (not zero) coverage.
export const VENDORS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  perplexity: "Perplexity",
  google: "Google",
  bytedance: "ByteDance",
  amazon: "Amazon",
  meta: "Meta",
  default: "Other / unlisted",
};

export const KNOWN_AGENTS = [
  {
    name: "GPTBot",
    ua: "gptbot",
    vendor: "openai",
    verify: "rdns",
    verifyHosts: [/\.gptbot\.openai\.com$/, /\.openai\.com$/],
    intent: "training",
  },
  {
    name: "OAI-SearchBot",
    ua: "oai-searchbot",
    vendor: "openai",
    verify: "rdns",
    verifyHosts: [/\.openai\.com$/],
    intent: "indexing",
  },
  {
    name: "ChatGPT-User",
    ua: "chatgpt-user",
    vendor: "openai",
    verify: "rdns",
    verifyHosts: [/\.openai\.com$/],
    intent: "live_search",
  },
  {
    name: "ClaudeBot",
    ua: "claudebot",
    vendor: "anthropic",
    verify: "rdns",
    verifyHosts: [/\.anthropic\.com$/, /\.claudebot\.com$/],
    intent: "training",
  },
  {
    name: "Claude-User",
    ua: "claude-user",
    vendor: "anthropic",
    verify: "rdns",
    verifyHosts: [/\.anthropic\.com$/],
    intent: "live_search",
  },
  {
    name: "PerplexityBot",
    ua: "perplexitybot",
    vendor: "perplexity",
    verify: "rdns",
    verifyHosts: [/\.perplexity\.ai$/],
    intent: "indexing",
  },
  {
    name: "Perplexity-User",
    ua: "perplexity-user",
    vendor: "perplexity",
    verify: "rdns",
    verifyHosts: [/\.perplexity\.ai$/],
    intent: "live_search",
  },
  {
    name: "Google-Extended",
    ua: "google-extended",
    vendor: "google",
    verify: "rdns",
    verifyHosts: [/\.googlebot\.com$/, /\.google\.com$/],
    intent: "training",
  },
  {
    name: "Bytespider",
    ua: "bytespider",
    vendor: "bytedance",
    verify: "none",
    intent: "training",
  },
  {
    name: "Amazonbot",
    ua: "amazonbot",
    vendor: "amazon",
    verify: "rdns",
    verifyHosts: [/\.crawl\.amazonbot\.amazon$/],
    intent: "indexing",
  },
  {
    name: "Meta-ExternalAgent",
    ua: "meta-externalagent",
    vendor: "meta",
    verify: "none",
    intent: "training",
  },
];

// Match a User-Agent string to a known agent, or null.
export function matchAgent(userAgent = "") {
  const ua = userAgent.toLowerCase();
  return KNOWN_AGENTS.find((a) => ua.includes(a.ua)) || null;
}

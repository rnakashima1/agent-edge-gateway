// Known AI agent registry.
//
// `ua` is a case-insensitive substring match against the User-Agent (a *hint*,
// since UA is self-declared and trivially spoofed). `verify` names the method
// detect.js should use to actually trust the identity before charging or
// granting access. `intent` buckets the traffic for policy/pricing.
//
// verify:
//   "rdns"      reverse+forward DNS must resolve to `verifyHosts`
//   "web-bot-auth"  HTTP Message Signature over the request (preferred)
//   "none"      declared only — never enough to monetize, only to soft-classify
//
// intent: "training" | "indexing" | "live_search"

export const KNOWN_AGENTS = [
  {
    name: "GPTBot",
    ua: "gptbot",
    verify: "rdns",
    verifyHosts: [/\.gptbot\.openai\.com$/, /\.openai\.com$/],
    intent: "training",
  },
  {
    name: "OAI-SearchBot",
    ua: "oai-searchbot",
    verify: "rdns",
    verifyHosts: [/\.openai\.com$/],
    intent: "indexing",
  },
  {
    name: "ChatGPT-User",
    ua: "chatgpt-user",
    verify: "rdns",
    verifyHosts: [/\.openai\.com$/],
    intent: "live_search",
  },
  {
    name: "ClaudeBot",
    ua: "claudebot",
    verify: "rdns",
    verifyHosts: [/\.anthropic\.com$/, /\.claudebot\.com$/],
    intent: "training",
  },
  {
    name: "Claude-User",
    ua: "claude-user",
    verify: "rdns",
    verifyHosts: [/\.anthropic\.com$/],
    intent: "live_search",
  },
  {
    name: "PerplexityBot",
    ua: "perplexitybot",
    verify: "rdns",
    verifyHosts: [/\.perplexity\.ai$/],
    intent: "indexing",
  },
  {
    name: "Perplexity-User",
    ua: "perplexity-user",
    verify: "rdns",
    verifyHosts: [/\.perplexity\.ai$/],
    intent: "live_search",
  },
  {
    name: "Google-Extended",
    ua: "google-extended",
    verify: "rdns",
    verifyHosts: [/\.googlebot\.com$/, /\.google\.com$/],
    intent: "training",
  },
  {
    name: "Bytespider",
    ua: "bytespider",
    verify: "none",
    intent: "training",
  },
  {
    name: "Amazonbot",
    ua: "amazonbot",
    verify: "rdns",
    verifyHosts: [/\.crawl\.amazonbot\.amazon$/],
    intent: "indexing",
  },
  {
    name: "Meta-ExternalAgent",
    ua: "meta-externalagent",
    verify: "none",
    intent: "training",
  },
];

// Match a User-Agent string to a known agent, or null.
export function matchAgent(userAgent = "") {
  const ua = userAgent.toLowerCase();
  return KNOWN_AGENTS.find((a) => ua.includes(a.ua)) || null;
}

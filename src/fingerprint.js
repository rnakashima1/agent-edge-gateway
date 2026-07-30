// Fingerprint heuristics.
//
// On Cloudflare, TLS fingerprint data is handed to the Worker on
// `request.cf` (ja3Hash / ja4, botManagement.*). On raw platforms you'd
// compute JA3/JA4 at the TLS terminator and pass it as a header. This module
// turns those raw signals into a coherence assessment: does the request *look*
// like the browser its User-Agent claims to be?
//
// The core tell: a User-Agent claiming a real browser paired with a
// scripting-library TLS/HTTP fingerprint (curl, python-requests, Go, headless
// automation) is almost certainly an undeclared bot.

// TLS/HTTP fingerprints commonly associated with non-browser HTTP clients.
// In production these come from a maintained JA3/JA4 intelligence feed; this
// short list is illustrative.
const SCRIPT_CLIENT_JA4 = new Set([
  // e.g. "t13d1516h2_..." curl / requests families — placeholders:
  "curl",
  "python-requests",
  "go-http-client",
  "node-fetch",
]);

const BROWSER_UA_HINT = /(chrome|firefox|safari|edg)\//i;

// Real browsers send UA client-hint headers and a rich Accept-Language.
function hasBrowserHeaders(headers) {
  const hasClientHints =
    headers.has("sec-ch-ua") || headers.has("sec-fetch-mode");
  const acceptLang = headers.get("accept-language");
  const accept = headers.get("accept") || "";
  const asksForHtml = accept.includes("text/html");
  return { hasClientHints, hasAcceptLang: !!acceptLang, asksForHtml };
}

/**
 * @returns {{
 *   ja4: string|null,
 *   looksScripted: boolean,
 *   claimsBrowser: boolean,
 *   incoherent: boolean,   // claims a browser but doesn't behave like one
 *   notes: string[]
 * }}
 */
export function fingerprint(request) {
  const cf = request.cf || {};
  const headers = request.headers;
  const ua = headers.get("user-agent") || "";
  const ja4 = cf.ja4 || cf.ja3Hash || headers.get("x-tls-ja4") || null;

  const notes = [];
  const claimsBrowser = BROWSER_UA_HINT.test(ua);

  const looksScripted =
    (ja4 && SCRIPT_CLIENT_JA4.has(ja4)) ||
    /(curl|python-requests|go-http-client|node-fetch|axios|okhttp)/i.test(ua);
  if (looksScripted) notes.push("scripted-client-fingerprint");

  const { hasClientHints, hasAcceptLang, asksForHtml } =
    hasBrowserHeaders(headers);

  // A UA that says "Chrome" but sends no client hints, no Accept-Language,
  // and doesn't ask for HTML is not a real Chrome.
  let incoherent = false;
  if (claimsBrowser && !hasClientHints && !hasAcceptLang && !asksForHtml) {
    incoherent = true;
    notes.push("browser-ua-without-browser-headers");
  }
  if (claimsBrowser && looksScripted) {
    incoherent = true;
    notes.push("browser-ua-with-scripted-fingerprint");
  }

  // Cloudflare's own bot score, if present (1 = definitely automated,
  // 99 = definitely human).
  const botScore = cf.botManagement && cf.botManagement.score;
  if (typeof botScore === "number" && botScore <= 30) {
    notes.push(`cf-bot-score:${botScore}`);
  }

  return { ja4, looksScripted, claimsBrowser, incoherent, botScore, notes };
}

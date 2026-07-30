// Build the AI-optimized response variant.
//
// HONESTY CONSTRAINT: this is a *format shift*, not a *content shift*. We take
// the same origin HTML and strip chrome (nav, ads, scripts, styling) down to
// the semantic content, then attach structured metadata (JSON-LD) and explicit
// license/attribution terms. The facts an agent reads must equal the facts a
// human reads. Do not inject claims here that a human wouldn't see — that is
// deceptive cloaking.
//
// A production version would use an HTML parser (Cloudflare HTMLRewriter) to
// extract <main>/<article> and drop non-content nodes. This keeps a small,
// dependency-free version.

function extractMainContent(html) {
  const main = html.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  const body = main ? main[1] : html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<(?:header|footer|aside)[\s\S]*?<\/(?:header|footer|aside)>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "") // strip inline handlers
    .trim();
}

function title(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : "";
}

/**
 * @param originResponse Response from origin (the human page)
 * @param ctx { url, intent, agentName, licenseUrl }
 */
export async function toAgentVariant(originResponse, ctx) {
  const html = await originResponse.text();
  const content = extractMainContent(html);
  const pageTitle = title(html);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: pageTitle,
    url: ctx.url.toString(),
    // Machine-readable usage terms travel with the content.
    license: ctx.licenseUrl || `${ctx.url.origin}/license`,
    usageInfo: `Served to verified agent "${ctx.agentName}" for intent "${ctx.intent}". Attribution required.`,
  };

  const optimized = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${pageTitle}</title>
<link rel="license" href="${jsonLd.license}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<main>
${content}
</main>
</body>
</html>`;

  return new Response(optimized, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Tell caches this response varies by client identity.
      vary: "User-Agent",
      "x-agent-variant": ctx.agentName,
      "x-content-intent": ctx.intent,
      link: `<${jsonLd.license}>; rel="license"`,
    },
  });
}

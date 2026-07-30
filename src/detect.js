// Classification: combine declared identity, verified identity, and
// fingerprint into a single verdict.
//
// Output:
//   {
//     kind: "human" | "known_agent" | "suspected_bot",
//     agent: <registry entry> | null,
//     verified: boolean,       // did we cryptographically/DNS-prove identity?
//     intent: "training"|"indexing"|"live_search"|null,
//     confidence: 0..1,
//     signals: string[]
//   }

import { matchAgent } from "../config/agents.js";
import { fingerprint } from "./fingerprint.js";

/**
 * Verify a claimed agent identity.
 *
 * Real implementations do one of:
 *  - reverse+forward DNS (resolve client IP -> host, host -> IP, host matches
 *    an allowed suffix). Requires a DNS resolver binding on the edge.
 *  - Web Bot Auth: verify the HTTP Message Signature (`Signature` /
 *    `Signature-Input`) against the vendor's published key directory.
 *
 * Both need async I/O and platform bindings, so this is a stub that reads an
 * already-computed result off the request (e.g. a header your TLS/DNS layer
 * set). Wire the real check here.
 */
async function verifyIdentity(request, agent, env) {
  if (!agent || agent.verify === "none") return false;

  if (agent.verify === "web-bot-auth") {
    // return await verifyWebBotAuth(request, env);  // HTTP Message Signatures
    return request.headers.get("x-verified-bot-auth") === "true";
  }

  if (agent.verify === "rdns") {
    // const host = await reverseDns(clientIp(request), env);
    // return host && agent.verifyHosts.some((re) => re.test(host))
    //   && (await forwardDns(host, env)).includes(clientIp(request));
    const host = request.headers.get("x-verified-rdns-host");
    return !!host && agent.verifyHosts.some((re) => re.test(host));
  }

  return false;
}

export async function classify(request, env) {
  const ua = request.headers.get("user-agent") || "";
  const fp = fingerprint(request);
  const signals = [...fp.notes];

  const agent = matchAgent(ua);

  if (agent) {
    const verified = await verifyIdentity(request, agent, env);
    signals.push(`declared:${agent.name}`);
    signals.push(verified ? "identity:verified" : "identity:unverified");
    return {
      kind: "known_agent",
      agent,
      verified,
      intent: agent.intent,
      confidence: verified ? 0.99 : 0.6,
      signals,
    };
  }

  // No known UA. Is it a browser that behaves like a browser? -> human.
  const humanScore = typeof fp.botScore === "number" ? fp.botScore : null;
  const looksHuman =
    fp.claimsBrowser &&
    !fp.incoherent &&
    !fp.looksScripted &&
    (humanScore === null || humanScore > 30);

  if (looksHuman) {
    return {
      kind: "human",
      agent: null,
      verified: false,
      intent: null,
      confidence: 0.9,
      signals,
    };
  }

  // Undeclared automation: browser UA that fails coherence, a scripted client,
  // or a low bot score. Treat as an unidentified bot (no intent -> can't
  // monetize, only pass or block per policy default).
  signals.push("undeclared-automation");
  return {
    kind: "suspected_bot",
    agent: null,
    verified: false,
    intent: null,
    confidence: fp.incoherent || fp.looksScripted ? 0.8 : 0.5,
    signals,
  };
}

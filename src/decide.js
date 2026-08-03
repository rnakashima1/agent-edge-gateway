// Policy engine: turn a classification + the live policy doc into a concrete
// action.
//
// Returns { action, priceUsd?, vendor?, reason }.
//   action: "pass" | "optimize" | "block" | "monetize"
//
// The policy doc is loaded from KV (src/config-store.js) and passed in, so
// pricing/actions can be edited from the admin UI without a redeploy.

import { resolve } from "../config/policy.js";

export function decide(classification, policyDoc) {
  const { kind, verified, intent, agent } = classification;
  const vendor = agent && agent.vendor;

  // Humans always pass.
  if (kind === "human") {
    return { action: "pass", reason: "human" };
  }

  // Undeclared bots have no billing identity and no intent. Apply the site
  // default (usually "pass"); tighten to "block" here if you run strict.
  if (kind === "suspected_bot") {
    return { action: "pass", reason: "undeclared-bot-default" };
  }

  // Known agent: resolve by vendor (frontier lab) + intent.
  const rule = resolve(policyDoc, vendor, intent);

  // You cannot bill or trust an identity you couldn't verify. Downgrade:
  //   monetize -> block, optimize -> block. pass/block unchanged.
  if (!verified && (rule.action === "monetize" || rule.action === "optimize")) {
    return {
      action: "block",
      vendor,
      reason: `unverified-${vendor}-${intent}-downgraded-from-${rule.action}`,
    };
  }

  return { ...rule, reason: `${vendor}:${intent}:${rule.action}(${rule.source})` };
}

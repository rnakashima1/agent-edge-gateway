// Policy engine: turn a classification + the page rules into a concrete action.
//
// Returns { action, priceUsd?, reason }.
//   action: "pass" | "optimize" | "block" | "monetize"

import { policyFor } from "../config/policy.js";

export function decide(classification, url) {
  const { kind, verified, intent } = classification;

  // Humans always pass.
  if (kind === "human") {
    return { action: "pass", reason: "human" };
  }

  // Undeclared bots have no billing identity and no intent. Apply the path's
  // default (usually "pass"); tighten to "block" here if you run strict.
  if (kind === "suspected_bot") {
    return { action: "pass", reason: "undeclared-bot-default" };
  }

  // Known agent: look up the page rule for its intent.
  const rule = policyFor(url, intent);

  // You cannot bill or trust an identity you couldn't verify. Downgrade:
  //   monetize -> block, optimize -> block. pass/block unchanged.
  if (!verified && (rule.action === "monetize" || rule.action === "optimize")) {
    return {
      action: "block",
      reason: `unverified-${intent}-downgraded-from-${rule.action}`,
    };
  }

  return { ...rule, reason: `${intent}:${rule.action}` };
}

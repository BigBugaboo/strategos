// Heuristic detection of a CLI running out of quota / hitting a hard rate or
// billing limit. Different agent CLIs phrase this differently, so we scan their
// combined output for the common signals. Only meaningful on a failed run, so
// callers should gate on failure before acting on this.
const QUOTA_PATTERNS = [
  /usage limit/i,
  /rate.?limit/i,
  /\bquota\b/i,
  /insufficient[_ ]quota/i,
  /out of (credits|tokens|quota)/i,
  /credit balance is too low/i,
  /too many requests/i,
  /\b429\b/,
  /reached your .{0,40}limit/i,
  /exceeded your current/i,
];

export function isQuotaError(result) {
  if (!result) return false;
  // Interruptions and timeouts are not quota problems; do not fail over on them.
  if (result.aborted || result.timedOut) return false;
  const text = `${result.stderr || ""}\n${result.stdout || ""}`;
  return QUOTA_PATTERNS.some((pattern) => pattern.test(text));
}

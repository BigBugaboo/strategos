import { describe, expect, it } from "vite-plus/test";
import { availableAgentNames, quotaLabel } from "./model.js";

describe("capacity presentation", () => {
  it("labels exhausted and unknown capacity without inventing a percentage", () => {
    expect(quotaLabel({ state: "exhausted", remainingPercent: 0 })).toBe("No quota — off");
    expect(quotaLabel({ state: "unknown", remainingPercent: null })).toBe("Unknown");
  });

  it("returns only installed and eligible agents", () => {
    expect(
      availableAgentNames([
        { name: "claude", installed: true, eligible: true },
        { name: "codex", installed: false, eligible: false },
        { name: "copilot", installed: true, eligible: false },
      ]),
    ).toEqual(["claude"]);
  });
});

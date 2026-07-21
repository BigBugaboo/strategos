import { describe, expect, it } from "vite-plus/test";
import { availableAgentNames, historyDate, quotaLabel, sessionTaskState } from "./model.js";

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

describe("real session presentation", () => {
  it("formats history dates relative to the current day", () => {
    const now = new Date("2026-07-21T12:00:00+08:00");
    expect(historyDate("2026-07-21T10:24:00+08:00", now)).toMatch(/10:24/);
    expect(historyDate("2026-07-20T23:59:00+08:00", now)).toBe("Yesterday");
  });

  it("derives active tasks and changed files from persisted and live events", () => {
    const session = {
      plan: {
        tasks: [
          { id: "implementation", agent: "claude" },
          { id: "review", agent: "codex" },
        ],
      },
      events: [{ type: "task_started", task: { id: "implementation", agent: "claude" } }],
    };
    const result = sessionTaskState(session, [
      {
        type: "task_finished",
        task: {
          id: "implementation",
          agent: "claude",
          status: "succeeded",
          changedFiles: ["src/index.js"],
        },
      },
      { type: "task_preparing", task: { id: "review", agent: "codex" } },
    ]);

    expect(result.activeTasks).toEqual([
      expect.objectContaining({ id: "review", agent: "codex", status: "preparing" }),
    ]);
    expect(result.changedFiles).toEqual(["src/index.js"]);
  });
});

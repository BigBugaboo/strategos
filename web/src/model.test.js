import { describe, expect, it } from "vite-plus/test";
import {
  availableAgentNames,
  historyDate,
  mergeSessionEvents,
  quotaLabel,
  sessionActivityState,
  sessionTaskState,
  shouldSubmitComposerKey,
} from "./model.js";

describe("capacity presentation", () => {
  it("labels exhausted and unknown capacity without inventing a percentage", () => {
    expect(quotaLabel({ state: "exhausted", remainingPercent: 0 })).toBe("No quota — off");
    expect(quotaLabel({ state: "unknown", remainingPercent: null })).toBe("Unknown");
    expect(quotaLabel({ state: "unknown", remainingPercent: 72 })).toBe("Unknown");
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

describe("composer keyboard behavior", () => {
  it("submits a plain Enter but keeps IME confirmation and Shift+Enter in the editor", () => {
    expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: false })).toBe(true);
    expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitComposerKey({ key: "Enter", isComposing: true })).toBe(false);
    expect(shouldSubmitComposerKey({ key: "Enter", keyCode: 229 })).toBe(false);
    expect(shouldSubmitComposerKey({ key: "Enter" }, true)).toBe(false);
    expect(shouldSubmitComposerKey({ key: "a" })).toBe(false);
  });
});

describe("real session presentation", () => {
  it("formats history dates relative to the current day", () => {
    const now = new Date(2026, 6, 21, 12);
    expect(historyDate(new Date(2026, 6, 21, 10, 24), now)).toMatch(/10:24/);
    expect(historyDate(new Date(2026, 6, 20, 23, 59), now)).toBe("Yesterday");
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

  it("shows the headless strategist as active while planning", () => {
    expect(sessionActivityState({ status: "planning", strategist: "codex" }, [], true)).toEqual(
      expect.objectContaining({
        detached: false,
        activities: [
          expect.objectContaining({
            agent: "codex",
            kind: "strategist",
            label: "Planning task graph",
          }),
        ],
      }),
    );
    expect(sessionActivityState({ status: "planning", strategist: "codex" }, [], false)).toEqual(
      expect.objectContaining({ detached: true, activities: [] }),
    );
  });

  it("marks orphaned worker execution as detached after a server restart", () => {
    const session = {
      status: "running",
      events: [{ type: "task_started", task: { id: "worker", agent: "claude" } }],
    };
    expect(sessionActivityState(session, [], false)).toEqual(
      expect.objectContaining({ detached: true, activities: [] }),
    );
  });

  it("deduplicates persisted and live copies of the same event", () => {
    const event = {
      type: "planning_started",
      at: "2026-07-21T10:41:53.000Z",
      strategist: "codex",
    };
    expect(mergeSessionEvents([event], [{ ...event }])).toEqual([event]);
  });
});

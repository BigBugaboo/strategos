import { describe, expect, it } from "vite-plus/test";
import {
  historyDate,
  mergeSessionEvents,
  notificationOutcome,
  sessionActivityState,
  sessionTaskState,
  shouldSubmitComposerKey,
  shouldNotifyForEvent,
  sortSidebarSessions,
} from "./model.js";

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

describe("sidebar session ordering", () => {
  it("keeps pinned sessions first and otherwise sorts by recent activity", () => {
    expect(
      sortSidebarSessions([
        { id: "recent", updatedAt: "2026-07-22T10:00:00.000Z" },
        { id: "pinned-old", pinned: true, updatedAt: "2026-07-20T10:00:00.000Z" },
        { id: "older", updatedAt: "2026-07-21T10:00:00.000Z" },
        { id: "pinned-new", pinned: true, updatedAt: "2026-07-21T10:00:00.000Z" },
      ]).map((session) => session.id),
    ).toEqual(["pinned-new", "pinned-old", "recent", "older"]);
  });
});

describe("task completion notifications", () => {
  const enabled = { enabled: true, onSuccess: true, onFailure: true };

  it("classifies terminal session events", () => {
    expect(notificationOutcome({ type: "session_complete", status: "succeeded" })).toBe("success");
    expect(notificationOutcome({ type: "session_complete", status: "failed" })).toBe("failure");
    expect(notificationOutcome({ type: "session_error" })).toBe("failure");
    expect(notificationOutcome({ type: "session_interrupted" })).toBe("failure");
    expect(notificationOutcome({ type: "run_finished" })).toBeNull();
  });

  it("respects the master and per-outcome preferences", () => {
    expect(shouldNotifyForEvent(enabled, { type: "session_complete", status: "succeeded" })).toBe(
      true,
    );
    expect(
      shouldNotifyForEvent(
        { ...enabled, onSuccess: false },
        { type: "session_complete", status: "succeeded" },
      ),
    ).toBe(false);
    expect(shouldNotifyForEvent({ ...enabled, onFailure: false }, { type: "session_error" })).toBe(
      false,
    );
    expect(shouldNotifyForEvent({ ...enabled, enabled: false }, { type: "session_error" })).toBe(
      false,
    );
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

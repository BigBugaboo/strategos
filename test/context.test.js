import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTaskPrompt, collectContext } from "../src/context.js";

test("collects repository context and blocks path traversal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-context-"));
  await fs.writeFile(path.join(root, "AGENTS.md"), "Run npm test", "utf8");
  const context = await collectContext(root, ["AGENTS.md"], 10_000);
  assert.match(context, /Run npm test/);
  await assert.rejects(() => collectContext(root, ["../secret"], 10_000), /escapes the repository/);
});

test("blocks repository symlinks that resolve outside the repository", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-symlink-"));
  const outside = path.join(os.tmpdir(), `strategos-secret-${Date.now()}.txt`);
  await fs.writeFile(outside, "secret", "utf8");
  try {
    await fs.symlink(outside, path.join(root, "linked-secret"));
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("symlinks are not permitted on this platform");
      return;
    }
    throw error;
  }
  await assert.rejects(
    () => collectContext(root, ["linked-secret"], 10_000),
    /symlink escapes the repository/,
  );
});

test("compiled prompt carries dependency reports and completion contract", () => {
  const prompt = buildTaskPrompt({
    plan: { goal: "Ship safely" },
    task: { id: "review", agent: "copilot", mode: "read-only", prompt: "Review" },
    sharedContext: "Project rules",
    runMemory: "Earlier decision",
    dependencyReports: [{ id: "implementation", report: "Tests passed" }],
    attachments: [{
      id: "design",
      relativePath: ".strategos/attachments/design.png",
      mimeType: "image/png",
    }],
  });
  assert.match(prompt, /Ship safely/);
  assert.match(prompt, /Tests passed/);
  assert.match(prompt, /Commands\/tests run/);
  assert.match(prompt, /\.strategos\/attachments\/design\.png/);
  assert.match(prompt, /untrusted user context/);
});

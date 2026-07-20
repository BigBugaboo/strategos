import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { runCommand } from "../src/process.js";

test("aborts a running child process", async () => {
  const controller = new AbortController();
  const running = runCommand(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  assert.equal(result.aborted, true);
  assert.notEqual(result.code, 0);
});

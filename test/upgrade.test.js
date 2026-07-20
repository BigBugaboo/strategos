import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GITHUB_PACKAGE_SPEC,
  buildUpgradePlan,
  detectInstallation,
  upgradeStrategos,
} from "../src/upgrade.js";

test("detects a source checkout without consulting npm", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-upgrade-source-"));
  await fs.mkdir(path.join(root, ".git"));
  const installation = await detectInstallation({
    packageRoot: root,
    run: () => assert.fail("npm should not be called"),
  });
  assert.equal(installation.mode, "source");
});

test("detects npx cache packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-upgrade-npx-"));
  const packageRoot = path.join(root, "_npx", "cache", "node_modules", "strategos-cli");
  await fs.mkdir(packageRoot, { recursive: true });
  const installation = await detectInstallation({ packageRoot });
  assert.equal(installation.mode, "npx");
});

test("detects packages inside the active global npm root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-upgrade-global-"));
  const packageRoot = path.join(root, "lib", "node_modules", "strategos-cli");
  await fs.mkdir(packageRoot, { recursive: true });
  const installation = await detectInstallation({ packageRoot, globalRoot: path.join(root, "lib", "node_modules") });
  assert.equal(installation.mode, "global-npm");
});

test("global npm installs can update automatically", async () => {
  const plan = buildUpgradePlan({ mode: "global-npm", packageRoot: "/tmp/strategos" });
  assert.equal(plan.automatic, true);
  assert.deepEqual(plan.commands[0], {
    command: "npm",
    args: ["install", "--global", GITHUB_PACKAGE_SPEC],
  });
});

test("dry-run never executes an installation command", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-upgrade-dry-"));
  const packageRoot = path.join(root, "lib", "node_modules", "strategos-cli");
  const globalRoot = path.join(root, "lib", "node_modules");
  await fs.mkdir(packageRoot, { recursive: true });
  const result = await upgradeStrategos({
    packageRoot,
    globalRoot,
    dryRun: true,
    run: () => assert.fail("upgrade should not run"),
  });
  assert.equal(result.plan.installation.mode, "global-npm");
  assert.equal(result.updated, false);
});

test("automatic upgrade verifies the installed command version", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-upgrade-apply-"));
  const packageRoot = path.join(root, "lib", "node_modules", "strategos-cli");
  const globalRoot = path.join(root, "lib", "node_modules");
  await fs.mkdir(packageRoot, { recursive: true });
  const calls = [];
  const result = await upgradeStrategos({
    packageRoot,
    globalRoot,
    entrypoint: "/tmp/strategos/bin/strategos.js",
    nodeExecutable: "node",
    run: async (command, args) => {
      calls.push([command, args]);
      return { code: 0, stdout: command === "node" ? "0.2.0\n" : "", stderr: "" };
    },
  });
  assert.deepEqual(calls, [
    ["npm", ["install", "--global", GITHUB_PACKAGE_SPEC]],
    ["node", ["/tmp/strategos/bin/strategos.js", "--version"]],
  ]);
  assert.equal(result.updated, true);
  assert.equal(result.version, "0.2.0");
});

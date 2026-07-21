import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("package metadata carries one valid release version", async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));
  const packageLock = JSON.parse(await fs.readFile(new URL("../package-lock.json", import.meta.url)));

  assert.match(
    packageJson.version,
    /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
});

test("release workflow verifies and publishes an unreleased package version", async () => {
  const workflow = await fs.readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /push:\s*\n\s+branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /node-version-file: \.node-version/);
  assert.match(workflow, /gh release view "\$tag"/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--generate-notes/);
});

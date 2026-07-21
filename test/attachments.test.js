import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  attachImage,
  captureClipboardImage,
  materializeAttachments,
  resolveAttachments,
} from "../src/attachments.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("stores validated images once and resolves durable attachment metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-attachment-"));
  await fs.mkdir(path.join(root, ".git", "info"), { recursive: true });
  const source = path.join(root, "design screenshot.png");
  await fs.writeFile(source, PNG);

  const first = await attachImage(root, source);
  const second = await attachImage(root, source);
  assert.equal(first.id, second.id);
  assert.equal(first.mimeType, "image/png");
  assert.match(first.relativePath, /^\.strategos\/attachments\/[a-f0-9]{12}-design-screenshot\.png$/);
  assert.match(
    await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf8"),
    /^\.strategos\/attachments\/$/m,
  );

  const [resolved] = await resolveAttachments(root, [first]);
  assert.equal(resolved.path, await fs.realpath(path.join(root, ...first.relativePath.split("/"))));
  assert.equal(resolved.size, PNG.byteLength);
});

test("copies image context into an isolated worker worktree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-materialize-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-worker-"));
  await fs.mkdir(path.join(root, ".git", "info"), { recursive: true });
  const source = path.join(root, "wireframe.png");
  await fs.writeFile(source, PNG);
  const attachment = await attachImage(root, source);

  const [copy] = await materializeAttachments(root, workspace, [attachment.relativePath]);
  assert.equal(copy.path, path.join(workspace, ...attachment.relativePath.split("/")));
  assert.deepEqual(await fs.readFile(copy.path), PNG);
});

test("rejects unsupported files and explains optional clipboard setup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-invalid-image-"));
  await fs.mkdir(path.join(root, ".git", "info"), { recursive: true });
  const source = path.join(root, "notes.txt");
  await fs.writeFile(source, "not an image", "utf8");
  await assert.rejects(attachImage(root, source), /unsupported image format/);

  if (process.platform === "darwin") {
    await assert.rejects(
      captureClipboardImage(root, {
        runCommandFn: async () => ({ code: 127, error: { code: "ENOENT" } }),
      }),
      /brew install pngpaste/,
    );
  }
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CACHE_ROOT = path.join(os.homedir(), ".strategos", "cache");

function validateCacheRoot(cacheRoot) {
  const resolved = path.resolve(cacheRoot);
  if (path.basename(resolved) !== "cache" || path.basename(path.dirname(resolved)) !== ".strategos") {
    throw new Error(`refusing to clear an unexpected cache path: ${resolved}`);
  }
  return resolved;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function clearStrategosCache(options = {}) {
  const cacheRoot = validateCacheRoot(options.cacheRoot || CACHE_ROOT);
  const present = await exists(cacheRoot);

  if (!options.dryRun && present) {
    await fs.rm(cacheRoot, { recursive: true, force: true });
  }

  return {
    cacheRoot,
    dryRun: Boolean(options.dryRun),
    present,
    cleared: present && !options.dryRun,
  };
}

export function formatCacheClearResult(result) {
  const lines = [`Cache: ${result.cacheRoot}`];
  if (result.cleared) lines.push("Cleared the Strategos cache.");
  else if (result.dryRun) lines.push(result.present ? "Dry run: the cache would be removed." : "Dry run: the cache is already empty.");
  else lines.push("The Strategos cache is already empty.");
  lines.push("Project configuration, sessions, attachments, and run history were preserved.");
  return lines.join("\n");
}

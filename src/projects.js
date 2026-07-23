import os from "node:os";
import path from "node:path";
import { findRepoRoot } from "./git.js";
import { readJson, writeJson } from "./utils.js";

const DEFAULT_PROJECTS_FILE = path.join(os.homedir(), ".strategos", "projects.json");

function publicProject(projectPath) {
  return {
    name: path.basename(projectPath),
    path: projectPath,
  };
}

export function createProjectRegistry(options) {
  const initialRoot = path.resolve(options.initialRoot);
  const file = options.file || DEFAULT_PROJECTS_FILE;
  const findRepoRootFn = options.findRepoRootFn || findRepoRoot;
  let projectPaths;

  const load = async () => {
    if (projectPaths) return projectPaths;
    let saved = [];
    try {
      const input = await readJson(file);
      saved = Array.isArray(input.projects) ? input.projects : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    projectPaths = new Set([initialRoot]);
    for (const candidate of saved) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      try {
        projectPaths.add(path.resolve(await findRepoRootFn(path.resolve(candidate))));
      } catch {
        // Repositories moved or removed since the last launch are omitted.
      }
    }
    return projectPaths;
  };

  const persist = async () => {
    await writeJson(file, { version: 1, projects: [...projectPaths] });
  };

  return {
    async list() {
      const paths = [...await load()];
      return paths
        .map(publicProject)
        .sort((left, right) => {
          if (left.path === initialRoot) return -1;
          if (right.path === initialRoot) return 1;
          return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
        });
    },

    async add(inputPath) {
      if (typeof inputPath !== "string" || !inputPath.trim()) {
        throw Object.assign(new Error("project path is required"), { status: 400 });
      }
      let projectPath;
      try {
        projectPath = path.resolve(await findRepoRootFn(path.resolve(inputPath.trim())));
      } catch {
        throw Object.assign(new Error("project path must be inside an accessible Git repository"), {
          status: 400,
        });
      }
      await load();
      projectPaths.add(projectPath);
      await persist();
      return publicProject(projectPath);
    },

    async remove(inputPath) {
      if (typeof inputPath !== "string" || !inputPath.trim()) {
        throw Object.assign(new Error("project path is required"), { status: 400 });
      }
      let projectPath = path.resolve(inputPath.trim());
      try {
        projectPath = path.resolve(await findRepoRootFn(projectPath));
      } catch {
        // The repository may be gone; remove the path as given.
      }
      if (projectPath === initialRoot) {
        throw Object.assign(new Error("the launch project cannot be removed"), { status: 400 });
      }
      await load();
      projectPaths.delete(projectPath);
      await persist();
      return publicProject(projectPath);
    },

    async resolve(inputPath) {
      const requested = path.resolve(inputPath || initialRoot);
      const paths = await load();
      if (!paths.has(requested)) {
        throw Object.assign(new Error("project is not registered; add it before selecting it"), {
          status: 403,
        });
      }
      return publicProject(requested);
    },
  };
}

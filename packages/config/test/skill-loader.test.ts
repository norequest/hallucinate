import { describe, it, expect } from "vitest";
import { loadSkills } from "../src/skill-loader.js";
import type { FsReader } from "../src/loader.js";

/**
 * Extended in-memory FsReader that also supports listDirs.
 *
 * We track files AND directories so that listDirs can return the correct
 * subdir names. The makeFakeFs factory accepts both a flat file map
 * and an optional explicit directory list.
 */
function makeFakeFs(
  files: Record<string, string>,
  dirs: Record<string, string[]> = {},
): FsReader {
  return {
    async readFile(p: string): Promise<string> {
      const content = files[p];
      if (content === undefined) throw new Error(`File not found: ${p}`);
      return content;
    },
    async listFiles(dir: string, ext: string): Promise<string[]> {
      return Object.keys(files)
        .filter((p) => p.startsWith(dir + "/") && p.endsWith(ext))
        .map((p) => p.slice(dir.length + 1))
        .sort();
    },
    async exists(p: string): Promise<boolean> {
      if (Object.keys(files).some((f) => f === p || f.startsWith(p + "/"))) {
        return true;
      }
      if (Object.keys(dirs).some((d) => d === p)) {
        return true;
      }
      return false;
    },
    async listDirs(dir: string): Promise<string[]> {
      // If an explicit dirs map entry exists, return it.
      if (dirs[dir] !== undefined) {
        return dirs[dir]!;
      }
      // Fall back to inferring dirs from file paths.
      const result = new Set<string>();
      for (const p of Object.keys(files)) {
        if (p.startsWith(dir + "/")) {
          const rest = p.slice(dir.length + 1);
          const slash = rest.indexOf("/");
          if (slash !== -1) {
            result.add(rest.slice(0, slash));
          }
        }
      }
      return [...result].sort();
    },
  };
}

const ROOT = "/repo";
const SKILLS_DIR = `${ROOT}/.conductor/skills`;

const RUN_TESTS_MD = `---
name: run-tests
description: Runs the project test suite.
allowed-tools:
  - Run
  - Git
---

## Procedure

Run pnpm test and report failures.
`;

const MALFORMED_MD = `no frontmatter at all, just text`;

describe("loadSkills", () => {
  it("returns empty skills and no errors when .conductor/skills does not exist", async () => {
    const fs = makeFakeFs({});
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("loads one valid SKILL.md and returns its manifest", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.name).toBe("run-tests");
    expect(result.skills[0]?.allowedTools).toEqual(["Run", "Git"]);
    expect(result.errors).toHaveLength(0);
  });

  it("stores the body in the bodies map keyed by name", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.bodies.has("run-tests")).toBe(true);
    expect(result.bodies.get("run-tests")).toContain("pnpm test");
  });

  it("collects an error for a malformed SKILL.md and does not throw", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/bad-skill/SKILL.md`]: MALFORMED_MD,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("loads multiple valid skills from separate subdirs", async () => {
    const openapi_md = `---
name: openapi
description: Generates an OpenAPI spec.
---

Generate the spec.
`;
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
      [`${SKILLS_DIR}/openapi/SKILL.md`]: openapi_md,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(2);
    const names = result.skills.map((s) => s.name).sort();
    expect(names).toEqual(["openapi", "run-tests"]);
  });

  it("collects errors from a bad skill but still loads valid sibling skills", async () => {
    const openapi_md = `---
name: openapi
description: Generates an OpenAPI spec.
---

Generate the spec.
`;
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
      [`${SKILLS_DIR}/bad-skill/SKILL.md`]: MALFORMED_MD,
      [`${SKILLS_DIR}/openapi/SKILL.md`]: openapi_md,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(2);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

import * as nodePath from "node:path";
import type { FsReader } from "./loader.js";
import type { SkillManifest } from "./skill-types.js";
import { parseSkillMarkdown } from "./skill-parser.js";
import type { ValidationWarning } from "./types.js";

export interface SkillLoadResult {
  /** Successfully parsed skill manifests. */
  skills: SkillManifest[];
  /**
   * Map from skill name to the body text extracted from that skill's SKILL.md.
   * Used by compose.ts at spawn time. Only manifests that parsed successfully
   * are represented here.
   */
  bodies: Map<string, string>;
  /** Non-fatal warnings (e.g. an allowed-tools value that was coerced). */
  warnings: Array<{ source: string; warnings: ValidationWarning[] }>;
  /** Parse or read errors (never throws; all failures are collected here). */
  errors: Array<{ source: string; errors: string[] }>;
}

/**
 * Loads all skills from `.conductor/skills/<name>/SKILL.md` under the given
 * workspace root.
 *
 * If the `.conductor/skills` directory does not exist, returns an empty result
 * with no errors. Each subdirectory under `skills/` is treated as one skill.
 * Malformed SKILL.md files are collected as errors, not thrown.
 *
 * All filesystem access goes through the injected `FsReader`, which enforces
 * the `.conductor` symlink containment boundary (Issue 27 / S8).
 */
export async function loadSkills(
  workspaceRoot: string,
  fs: FsReader,
): Promise<SkillLoadResult> {
  const skillsDir = nodePath.join(workspaceRoot, ".conductor", "skills");

  const result: SkillLoadResult = {
    skills: [],
    bodies: new Map(),
    warnings: [],
    errors: [],
  };

  // Short-circuit if the skills directory does not exist.
  if (!(await fs.exists(skillsDir))) {
    return result;
  }

  const subdirs = await fs.listDirs(skillsDir);

  for (const subdir of subdirs) {
    const skillMdPath = nodePath.join(skillsDir, subdir, "SKILL.md");
    const source = nodePath.relative(workspaceRoot, skillMdPath);

    let text: string;
    try {
      text = await fs.readFile(skillMdPath);
    } catch (err) {
      result.errors.push({ source, errors: [`Failed to read SKILL.md: ${String(err)}`] });
      continue;
    }

    const parsed = parseSkillMarkdown(text, source);

    if (!parsed.manifest.ok) {
      result.errors.push({ source, errors: parsed.manifest.errors });
      continue;
    }

    if (parsed.manifest.warnings.length > 0) {
      result.warnings.push({ source, warnings: parsed.manifest.warnings });
    }

    result.skills.push(parsed.manifest.value);
    result.bodies.set(parsed.manifest.value.name, parsed.body);
  }

  return result;
}

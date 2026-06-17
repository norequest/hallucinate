/**
 * Real ConfigGateway implementation over @maestro/config + node fs.
 * Implements the ConfigGateway interface from library-controller.ts.
 * Node imports are isolated here; library-controller.ts stays node-free.
 */

import * as nodePath from "node:path";
import {
  loadSkills,
  loadConductorDir,
  loadSoul,
  serializeSkill,
  serializeRole,
  makeNodeFsReader,
  makeNodeFsWriter,
  KNOWN_ENGINE_IDS,
} from "@maestro/config";
import type { ConfigGateway } from "./library-controller.js";
import type { AnatomyGateway } from "./anatomy-controller.js";

/**
 * Refuse any name that is not a single, clean path segment before it is joined
 * onto a filesystem path. This is the R6 containment guard at the source: a name
 * carrying a separator or "." / ".." could otherwise traverse out of
 * .conductor/ (the writer's removeDir guard is only a backstop). Skill and role
 * names that fail this are rejected, never sanitized, so a write can never land
 * outside .conductor/<kind>/<name>.
 */
function assertSafeSegment(value: string, kind: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes(nodePath.sep)
  ) {
    throw new Error(`Unsafe ${kind} name "${value}": must be a single path segment.`);
  }
}

export function makeConfigGateway(repoRoot: string): ConfigGateway {
  return {
    async loadSkills() {
      const fsReader = await makeNodeFsReader();
      const result = await loadSkills(repoRoot, fsReader);
      return {
        skills: result.skills.map((s) => ({
          name: s.name,
          description: s.description,
          allowedTools: s.allowedTools,
          source: "authored" as const,
        })),
      };
    },

    async loadRoles() {
      const fsReader = await makeNodeFsReader();
      const result = await loadConductorDir(repoRoot, fsReader);
      return result.roles.map((r) => ({
        name: r.name,
        engineId: r.engine.id,
        skills: r.skills ?? [],
      }));
    },

    async loadTeams() {
      const fsReader = await makeNodeFsReader();
      const result = await loadConductorDir(repoRoot, fsReader);
      return result.teams.map((t) => ({
        name: t.name,
        roleNames: t.roles.map((r) => r.name),
      }));
    },

    async saveSkill(manifest, body) {
      assertSafeSegment(manifest.name, "skill");
      const fsWriter = await makeNodeFsWriter();
      const skillDir = nodePath.join(repoRoot, ".conductor", "skills", manifest.name);
      await fsWriter.mkdir(skillDir);
      const skillPath = nodePath.join(skillDir, "SKILL.md");
      await fsWriter.writeFile(skillPath, serializeSkill(manifest, body));
    },

    async deleteSkill(name) {
      assertSafeSegment(name, "skill");
      const fsWriter = await makeNodeFsWriter();
      const skillDir = nodePath.join(repoRoot, ".conductor", "skills", name);
      await fsWriter.removeDir(skillDir);
    },

    async setRoleSkills(roleName, skills) {
      const fsReader = await makeNodeFsReader();
      const result = await loadConductorDir(repoRoot, fsReader);
      const role = result.roles.find((r) => r.name === roleName);
      if (!role) {
        throw new Error(`Role "${roleName}" not found in .conductor/roles/`);
      }
      // Produce updated role: omit skills key when empty (keeps file clean)
      const updatedRole = skills.length > 0
        ? { ...role, skills }
        : { ...role, skills: undefined };
      const serialized = serializeRole(updatedRole);

      // Use a safe filename: lowercase roleName, spaces to hyphens.
      // The loader reads all *.yaml files in .conductor/roles/ so the exact
      // filename does not need to match, but mirroring the scaffolder's
      // convention (implementer.yaml for role "Implementer") keeps it tidy.
      const baseName = roleName.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(baseName, "role");
      const rolePath = nodePath.join(repoRoot, ".conductor", "roles", `${baseName}.yaml`);

      const fsWriter = await makeNodeFsWriter();
      await fsWriter.writeFile(rolePath, serialized);
    },
  };
}

export function makeAnatomyGateway(repoRoot: string): AnatomyGateway {
  return {
    async loadRole(roleName: string) {
      const fsReader = await makeNodeFsReader();
      const result = await loadConductorDir(repoRoot, fsReader);
      return result.roles.find((r) => r.name === roleName) ?? null;
    },

    async loadSoulBody(roleName: string) {
      try {
        const fsReader = await makeNodeFsReader();
        const result = await loadConductorDir(repoRoot, fsReader);
        const role = result.roles.find((r) => r.name === roleName);
        if (!role || !role.soul) return "";
        const soulResult = await loadSoul(repoRoot, role.soul, fsReader);
        if ("error" in soulResult) return "";
        return soulResult.soul.raw;
      } catch {
        return "";
      }
    },

    async loadSkillRequirements() {
      const fsReader = await makeNodeFsReader();
      const result = await loadSkills(repoRoot, fsReader);
      return result.skills.map((s) => ({ name: s.name, allowedTools: s.allowedTools }));
    },

    async writeRole(role) {
      const baseName = role.name.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(baseName, "role");
      const fsWriter = await makeNodeFsWriter();
      const rolePath = nodePath.join(repoRoot, ".conductor", "roles", `${baseName}.yaml`);
      await fsWriter.writeFile(rolePath, serializeRole(role));
    },

    async writeSoul(roleName, body) {
      const fsReader = await makeNodeFsReader();
      const result = await loadConductorDir(repoRoot, fsReader);
      const role = result.roles.find((r) => r.name === roleName);
      if (!role) throw new Error(`Role "${roleName}" not found`);

      const soulName = role.soul ?? roleName.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(soulName, "soul");

      const fsWriter = await makeNodeFsWriter();
      const soulPath = nodePath.join(repoRoot, ".conductor", "souls", `${soulName}.md`);
      await fsWriter.writeFile(soulPath, body);

      if (!role.soul) {
        const updatedRole = { ...role, soul: soulName };
        const baseName = roleName.toLowerCase().replace(/\s+/g, "-");
        assertSafeSegment(baseName, "role");
        const rolePath = nodePath.join(repoRoot, ".conductor", "roles", `${baseName}.yaml`);
        await fsWriter.writeFile(rolePath, serializeRole(updatedRole));
      }
    },

    isKnownEngineId(id: string) {
      return KNOWN_ENGINE_IDS.has(id);
    },
  };
}

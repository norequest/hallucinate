import { stringify as stringifyYaml } from "yaml";
import type { Role, Team } from "@maestro/core";
import type { SkillManifest } from "./skill-types.js";

/**
 * Serialize a Role to a YAML string suitable for writing to .conductor/roles/<name>.yaml.
 * Produces clean, human-readable output with no extra blank lines.
 */
export function serializeRole(role: Role): string {
  // Build tools YAML representation when present.
  let toolsDoc: Record<string, unknown> | undefined;
  if (role.tools !== undefined) {
    const builtins: Record<string, unknown> = {};
    if (role.tools.builtins?.read !== undefined && role.tools.builtins.read.length > 0) {
      builtins["read"] = role.tools.builtins.read;
    }
    if (role.tools.builtins?.write !== undefined && role.tools.builtins.write.length > 0) {
      builtins["write"] = role.tools.builtins.write;
    }
    const mcpList = role.tools.mcp;
    toolsDoc = {
      ...(Object.keys(builtins).length > 0 ? { builtins } : {}),
      ...(mcpList !== undefined && mcpList.length > 0 ? { mcp: mcpList } : {}),
    };
  }

  const doc: Record<string, unknown> = {
    name: role.name,
    instructions: role.instructions,
    engine: role.engine.model
      ? { id: role.engine.id, model: role.engine.model }
      : { id: role.engine.id },
    autonomy: role.autonomy,
    ...(role.skills !== undefined ? { skills: role.skills } : {}),
    ...(toolsDoc !== undefined ? { tools: toolsDoc } : {}),
    ...(role.soul !== undefined ? { soul: role.soul } : {}),
    ...(role.provenance !== undefined
      ? {
          provenance: {
            source: role.provenance.source,
            ...(role.provenance.sha !== undefined ? { sha: role.provenance.sha } : {}),
            adoptedAt: role.provenance.adoptedAt,
          },
        }
      : {}),
  };
  return stringifyYaml(doc, { lineWidth: 120 });
}

/**
 * Serialize a SkillManifest and body text to a SKILL.md string.
 * Produces a YAML frontmatter block followed by the body text.
 * Suitable for writing to .conductor/skills/<name>/SKILL.md.
 */
export function serializeSkill(manifest: SkillManifest, body: string): string {
  const frontmatterDoc: Record<string, unknown> = {
    name: manifest.name,
    description: manifest.description,
    ...(manifest.allowedTools !== undefined ? { "allowed-tools": manifest.allowedTools } : {}),
  };
  const frontmatter = stringifyYaml(frontmatterDoc, { lineWidth: 120 });
  return `---\n${frontmatter}---\n${body}`;
}

/**
 * Serialize a Team to a YAML string suitable for writing to .conductor/teams/<name>.yaml.
 * Role references are stored as name strings (resolved at load time).
 */
export function serializeTeam(team: Team): string {
  const doc: Record<string, unknown> = {
    name: team.name,
    roles: team.roles.map((r) => r.name),
  };
  return stringifyYaml(doc, { lineWidth: 120 });
}

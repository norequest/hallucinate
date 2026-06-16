/**
 * Pure HTML builders for the anatomy editor webview (no DOM, no node imports).
 * All role-sourced strings go through escapeHtml before interpolation.
 * Colors are graphite class names only (R2: no var(--vscode-*)).
 */

import { escapeHtml } from "./html.js";
import type { AnatomyVM } from "./anatomy-protocol.js";
import type { GrantGap } from "@maestro/config";

// ─── Built-in tool rows ───────────────────────────────────────────────────────

/** The five built-in tools the anatomy tools grid renders. */
const BUILTIN_READ_TOOLS = ["Read", "Search"] as const;
const BUILTIN_WRITE_TOOLS = ["Edit", "Run", "Git"] as const;
const ALL_BUILTIN_TOOLS = [...BUILTIN_READ_TOOLS, ...BUILTIN_WRITE_TOOLS] as const;

// ─── Rail ─────────────────────────────────────────────────────────────────────

/** The seven sections in the anatomy rail, in order. */
const RAIL_SECTIONS = [
  { id: "identity", label: "Identity" },
  { id: "soul", label: "Soul" },
  { id: "instructions", label: "Instructions" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "engine", label: "Engine" },
  { id: "autonomy", label: "Autonomy" },
] as const;

/**
 * Renders the left anatomy sub-rail with one row per section.
 * Each row gets a status dot: "filled" class when the section has content,
 * hollow otherwise. The `data-section` attribute identifies each row.
 */
export function renderAnatomyRail(vm: AnatomyVM): string {
  const filled = new Set<string>();

  if (vm.roleName) filled.add("identity");
  if (vm.soulName) filled.add("soul");
  if (vm.instructions) filled.add("instructions");
  if (vm.toolsSummary.granted > 0) filled.add("tools");
  if (vm.skills.length > 0) filled.add("skills");
  if (vm.engineId) filled.add("engine");
  if (vm.autonomy) filled.add("autonomy");

  const rows = RAIL_SECTIONS.map((section) => {
    const dotClass = filled.has(section.id) ? "anatomy-dot filled" : "anatomy-dot";
    return `<div class="anatomy-rail-row" data-section="${section.id}">
  <span class="${dotClass}"></span>
  <span class="anatomy-rail-label">${section.label}</span>
</div>`;
  });

  return `<nav class="anatomy-rail">${rows.join("")}</nav>`;
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

/** Renders one builtin tool row in the tools grid. */
function renderBuiltinToolRow(
  name: string,
  isWriteTool: boolean,
  hasRead: boolean,
  hasWrite: boolean
): string {
  const readChecked = hasRead ? " checked" : "";
  const writeChecked = hasWrite ? " checked" : "";

  const writeCell = isWriteTool
    ? `<input type="checkbox" class="anatomy-tool-write amber" data-tool="${name}" data-mode="write" title="Grant ${name} write"${writeChecked} />`
    : `<span class="anatomy-tool-write-placeholder"></span>`;

  return `<div class="anatomy-tool-row" data-tool="${name}">
  <span class="anatomy-tool-name">${escapeHtml(name)}</span>
  <input type="checkbox" class="anatomy-tool-read" data-tool="${name}" data-mode="read" title="Grant ${name} read"${readChecked} />
  ${writeCell}
</div>`;
}

/**
 * Renders the main scroll canvas: Identity, Soul, Instructions, Tools,
 * Skills, Engine, and Autonomy sections.
 * Every role-sourced string is escaped.
 */
export function renderAnatomyCanvas(vm: AnatomyVM): string {
  // ── Identity block
  const identityBlock = `<section class="anatomy-section" data-section="identity">
  <h3 class="anatomy-section-title">Identity</h3>
  <div class="anatomy-identity-name">${escapeHtml(vm.roleName)}</div>
  <div class="anatomy-identity-meta">${escapeHtml(vm.engineId)} · ${escapeHtml(vm.autonomy)}</div>
</section>`;

  // ── Soul
  const soulBlock = `<section class="anatomy-section" data-section="soul">
  <h3 class="anatomy-section-title">Soul</h3>
  <textarea class="anatomy-textarea" data-action="role-set-soul">${escapeHtml(vm.soulBody)}</textarea>
</section>`;

  // ── Instructions
  const instructionsBlock = `<section class="anatomy-section" data-section="instructions">
  <h3 class="anatomy-section-title">Instructions</h3>
  <textarea class="anatomy-textarea" data-action="role-set-instructions">${escapeHtml(vm.instructions)}</textarea>
</section>`;

  // ── Tools grid
  const readSet = new Set<string>(vm.tools?.builtins?.read ?? []);
  const writeSet = new Set<string>(vm.tools?.builtins?.write ?? []);

  const toolRows = ALL_BUILTIN_TOOLS.map((name) => {
    const isWriteTool = (BUILTIN_WRITE_TOOLS as readonly string[]).includes(name);
    const hasRead = readSet.has(name);
    const hasWrite = writeSet.has(name);
    return renderBuiltinToolRow(name, isWriteTool, hasRead, hasWrite);
  });

  const canWriteClass = vm.toolsSummary.canWrite > 0 ? " amber" : "";
  const summary = `<div class="anatomy-tools-summary">
  <span class="anatomy-tools-granted">${vm.toolsSummary.granted} granted</span>
  <span class="anatomy-tools-separator"> · </span>
  <span class="anatomy-tools-can-write${canWriteClass}">${vm.toolsSummary.canWrite} can write</span>
</div>`;

  const toolsBlock = `<section class="anatomy-section" data-section="tools">
  <h3 class="anatomy-section-title">Tools</h3>
  <div class="anatomy-tools-grid">${toolRows.join("")}</div>
  ${summary}
</section>`;

  // ── Skills
  const skillChips = vm.skills.map((s) => {
    const chip = `<span class="anatomy-skill-chip">&#9670; ${escapeHtml(s.name)}</span>`;
    return chip;
  });

  const skillsBlock = `<section class="anatomy-section" data-section="skills">
  <h3 class="anatomy-section-title">Skills</h3>
  <div class="anatomy-skills-list">${skillChips.join("")}</div>
</section>`;

  // ── Engine pills (show the active engine by name; the model is a sub-label)
  const engineLabel = vm.model
    ? `${escapeHtml(vm.engineId)} / ${escapeHtml(vm.model)}`
    : escapeHtml(vm.engineId);

  const engineBlock = `<section class="anatomy-section" data-section="engine">
  <h3 class="anatomy-section-title">Engine</h3>
  <div class="anatomy-engine-pills">
    <span class="anatomy-engine-pill active">${engineLabel}</span>
  </div>
</section>`;

  // ── Autonomy segmented control
  const autonomyOptions: Array<{ value: string; label: string }> = [
    { value: "manual", label: "Manual" },
    { value: "auto-approve-safe", label: "Auto-approve safe" },
    { value: "yolo", label: "Yolo" },
  ];

  const autonomyButtons = autonomyOptions.map((opt) => {
    const activeClass = vm.autonomy === opt.value ? " active" : "";
    return `<button class="anatomy-autonomy-btn${activeClass}" data-action="role-set-autonomy" data-value="${opt.value}">${opt.label}</button>`;
  });

  const autonomyBlock = `<section class="anatomy-section" data-section="autonomy">
  <h3 class="anatomy-section-title">Autonomy</h3>
  <div class="anatomy-autonomy-control">${autonomyButtons.join("")}</div>
</section>`;

  return `<div class="anatomy-canvas">
${identityBlock}
${soulBlock}
${instructionsBlock}
${toolsBlock}
${skillsBlock}
${engineBlock}
${autonomyBlock}
</div>`;
}

// ─── Grant gate ───────────────────────────────────────────────────────────────

/**
 * Renders the inline amber grant-gate expansion for a skill whose attach
 * needs a tool grant. Shows what is missing and offers three explicit choices:
 * grant, attach-anyway, or cancel. NO silent grant.
 *
 * @param skillName - The skill that needs a grant.
 * @param gap - The computed GrantGap (caller guarantees gap is non-null).
 * @param roleName - The role receiving the skill (used on data-role).
 */
export function renderGrantGate(skillName: string, gap: GrantGap, roleName: string): string {
  // Build copy describing the missing write grants (the most critical gap)
  const allMissing = [
    ...gap.missingWrite.map((t) => `${t}(write)`),
    ...gap.missingRead,
    ...gap.missingMcp.map((s) => `mcp:${s}`),
  ];

  const missingList = allMissing.map(escapeHtml).join(", ");

  // The primary grant button targets the first missing write tool (most likely single)
  const primaryTool = gap.missingWrite[0] ?? gap.missingRead[0] ?? gap.missingMcp[0] ?? "";
  const grantLabel = gap.missingWrite.length > 0
    ? `Grant ${escapeHtml(primaryTool)}(write)`
    : `Grant ${escapeHtml(primaryTool)}`;

  return `<div class="anatomy-grant-gate amber-border" data-skill="${escapeHtml(skillName)}" data-role="${escapeHtml(roleName)}">
  <p class="anatomy-grant-gate-copy">
    <strong>${escapeHtml(skillName)}</strong> needs ${escapeHtml(missingList)}.
    This agent does not have it yet.
  </p>
  <div class="anatomy-grant-gate-actions">
    <button class="anatomy-grant-btn" data-action="grant" data-skill="${escapeHtml(skillName)}" data-tool="${escapeHtml(primaryTool)}" data-write="${gap.missingWrite.length > 0}">${grantLabel}</button>
    <button class="anatomy-attach-btn" data-action="attach-anyway" data-skill="${escapeHtml(skillName)}">Attach without granting</button>
    <button class="anatomy-cancel-btn" data-action="cancel-grant" data-skill="${escapeHtml(skillName)}">Cancel</button>
  </div>
</div>`;
}

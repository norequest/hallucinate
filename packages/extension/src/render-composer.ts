import type { ComposerOptions } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";

/** Renders the preset chips section. */
function renderPresets(options: ComposerOptions): string {
  if (options.presets.length === 0) {
    return `<p class="composer-no-presets">No roles defined in .conductor/roles/. Enter a name below to create an ad-hoc role.</p>`;
  }
  const chips = options.presets
    .map(
      (p) =>
        `<button class="composer-chip" data-action="preset" data-role="${escapeHtml(p.roleName)}" data-engine="${escapeHtml(p.engineId)}"${p.model !== undefined ? ` data-model="${escapeHtml(p.model)}"` : ""} type="button">
  <span class="chip-role">${escapeHtml(p.roleName)}</span>
  <span class="chip-engine">${escapeHtml(p.engineId)}</span>
  <span class="chip-snippet">${escapeHtml(p.instructionsSnippet)}</span>
</button>`,
    )
    .join("");
  return `<div class="composer-presets">${chips}</div>`;
}

/** Renders the engine family + model variant pills. */
function renderEnginePills(options: ComposerOptions): string {
  const pills = options.engines
    .flatMap((family) => {
      // Family pill (no model)
      const familyPill = `<button class="composer-engine-pill" data-action="engine" data-engine="${escapeHtml(family.id)}" type="button">${escapeHtml(family.label)}</button>`;
      // Model variant pills
      const modelPills = family.models.map(
        (m) =>
          `<button class="composer-engine-pill composer-engine-pill--model" data-action="engine" data-engine="${escapeHtml(family.id)}" data-model="${escapeHtml(m)}" type="button">${escapeHtml(family.label)} / ${escapeHtml(m)}</button>`,
      );
      return [familyPill, ...modelPills];
    })
    .join("");
  return `<div class="composer-engine-pills">${pills}</div>`;
}

/**
 * Pure HTML-string renderer for the composer overlay panel.
 * Every role-sourced string (role name, instructions snippet) is run through
 * escapeHtml before being embedded in markup, in both text and attribute context.
 */
export function renderComposerHTML(options: ComposerOptions): string {
  return `<div class="composer-panel" role="dialog" aria-modal="true" aria-label="Dispatch a new agent">
  <header class="composer-header">
    <h2 class="composer-title">New Agent</h2>
    <button class="composer-close" data-action="close-composer" type="button" aria-label="Close">&#215;</button>
  </header>

  <section class="composer-section">
    <label class="composer-label">Role preset</label>
    ${renderPresets(options)}
    <div class="composer-new-role-row">
      <label class="composer-label composer-label--sub" for="composer-new-role">Or enter an ad-hoc role name</label>
      <input id="composer-new-role" class="composer-input" type="text" placeholder="e.g. Security Reviewer" data-action="new-role" />
    </div>
  </section>

  <section class="composer-section">
    <label class="composer-label">Engine</label>
    ${renderEnginePills(options)}
  </section>

  <section class="composer-section">
    <label class="composer-label" for="composer-goal">Goal <span class="composer-hint">(the why, "so that ...")</span></label>
    <input id="composer-goal" class="composer-input" type="text" placeholder="so that the refactor cannot silently break checkout" data-action="goal" />
  </section>

  <section class="composer-section">
    <label class="composer-label" for="composer-task">Task <span class="composer-required">*</span></label>
    <textarea id="composer-task" class="composer-textarea" rows="4" placeholder="Describe what this agent should do..." data-action="task"></textarea>
  </section>

  <footer class="composer-footer">
    <button class="composer-dispatch" data-action="dispatch" type="button" disabled>Dispatch</button>
  </footer>
</div>`;
}

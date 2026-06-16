import type { CockpitState, ComposerOptions, DispatchForm, HostToWebview, WebviewToHost } from "@maestro/cockpit";
import { buildDispatchMessage, canDispatch } from "@maestro/cockpit";
import { renderBoard, renderDrawer } from "../render.js";
import { renderComposerHTML } from "../render-composer.js";

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

// ─── Composer state ────────────────────────────────────────────────────────────

let composerForm: DispatchForm = { description: "" };
let activeComposerOptions: ComposerOptions | undefined;

function getComposerOverlay(): HTMLElement | null {
  return document.getElementById("composer-overlay");
}

function openComposer(options: ComposerOptions): void {
  activeComposerOptions = options;
  composerForm = { description: "" };

  let overlay = getComposerOverlay();
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "composer-overlay";
    overlay.className = "composer-overlay";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="composer-scrim" data-action="close-composer-scrim"></div>${renderComposerHTML(options)}`;
  overlay.hidden = false;
  syncDispatchButton();
}

function closeComposer(): void {
  const overlay = getComposerOverlay();
  if (overlay) overlay.hidden = true;
  activeComposerOptions = undefined;
  composerForm = { description: "" };
}

function syncDispatchButton(): void {
  const btn = document.querySelector<HTMLButtonElement>(".composer-dispatch");
  if (btn) btn.disabled = !canDispatch(composerForm);
}

function markPresetSelected(roleName: string): void {
  document.querySelectorAll<HTMLElement>(".composer-chip").forEach((chip) => {
    chip.classList.toggle("selected", chip.dataset["role"] === roleName);
  });
}

function markEnginePillSelected(engineId: string, model?: string): void {
  document.querySelectorAll<HTMLElement>(".composer-engine-pill").forEach((pill) => {
    const pillEngine = pill.dataset["engine"];
    const pillModel = pill.dataset["model"];
    const match = pillEngine === engineId && (model === undefined ? pillModel === undefined : pillModel === model);
    pill.classList.toggle("selected", match);
  });
}

// ─── Board render ──────────────────────────────────────────────────────────────

function render(state: CockpitState): void {
  if (!root) return;
  const board = state.cards.length
    ? renderBoard(state)
    : `<p class="empty">No agents yet. Use the Roster&#39;s + (New Agent) to start one.</p>`;
  root.innerHTML = `${board}${renderDrawer(state)}`;
  tickElapsed();
}

function tickElapsed(): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>(".elapsed[data-started]").forEach((el) => {
    const started = Number(el.dataset["started"]);
    if (!Number.isFinite(started)) return;
    const s = Math.max(0, Math.floor((now - started) / 1000));
    el.textContent = `${Math.floor(s / 60)}m ${s % 60}s`;
  });
}

setInterval(tickElapsed, 1000);

// ─── Host message listener (exhaustive switch) ────────────────────────────────

window.addEventListener("message", (e: MessageEvent<HostToWebview>) => {
  const data = e.data;
  switch (data.type) {
    case "state":
      render(data.state);
      break;
    case "composer-options":
      openComposer(data.options);
      break;
    default: {
      // Exhaustiveness guard: adding a new HostToWebview variant without
      // handling it here is a compile error.
      const _exhaustive: never = data;
      void _exhaustive;
      break;
    }
  }
});

// ─── Steer + send-back forms ──────────────────────────────────────────────────

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  const action = form.dataset["action"];
  const id = form.dataset["id"];
  if (!id) return;
  if (action === "steer") {
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>(".steer-input");
    const text = input?.value.trim();
    if (!text) return;
    vscode.postMessage({ type: "steer", agentId: id, input: text });
    if (input) input.value = "";
  } else if (action === "sendBack") {
    e.preventDefault();
    const textarea = form.querySelector<HTMLTextAreaElement>(".sendback-input");
    const text = textarea?.value.trim();
    if (!text) return;
    vscode.postMessage({ type: "sendBack", agentId: id, feedback: text });
    if (textarea) textarea.value = "";
  }
});

// ─── Keyboard: Escape closes the composer ────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const overlay = getComposerOverlay();
    if (overlay && !overlay.hidden) closeComposer();
  }
});

// ─── Click delegation ─────────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  // 0. Composer scrim backdrop click.
  if (target.closest<HTMLElement>('[data-action="close-composer-scrim"]')) {
    closeComposer();
    return;
  }

  // 0b. Composer close button.
  if (target.closest<HTMLElement>('[data-action="close-composer"]')) {
    closeComposer();
    return;
  }

  // 0c. Composer dispatch.
  if (target.closest<HTMLElement>('[data-action="dispatch"]')) {
    const msg = buildDispatchMessage(composerForm);
    if (msg) {
      vscode.postMessage(msg);
      closeComposer();
    }
    return;
  }

  // 0d. Preset chip selection.
  const presetChip = target.closest<HTMLElement>('[data-action="preset"]');
  if (presetChip) {
    const roleName = presetChip.dataset["role"];
    const engineId = presetChip.dataset["engine"];
    const model = presetChip.dataset["model"];
    if (roleName) {
      composerForm.roleName = roleName;
      delete composerForm.newRoleName;
    }
    if (engineId) {
      composerForm.engineId = engineId;
      composerForm.model = model;
    }
    // Clear new-role input
    const newRoleInput = document.querySelector<HTMLInputElement>('[data-action="new-role"]');
    if (newRoleInput) newRoleInput.value = "";
    if (roleName) markPresetSelected(roleName);
    if (engineId) markEnginePillSelected(engineId, model);
    syncDispatchButton();
    return;
  }

  // 0e. Engine pill selection.
  const enginePill = target.closest<HTMLElement>('[data-action="engine"]');
  if (enginePill) {
    const engineId = enginePill.dataset["engine"];
    const model = enginePill.dataset["model"];
    if (engineId) {
      composerForm.engineId = engineId;
      composerForm.model = model;
      markEnginePillSelected(engineId, model);
    }
    syncDispatchButton();
    return;
  }

  // 1. Local: drawer tab switching.
  const tabBtn = target.closest<HTMLElement>(".tab[data-tab]");
  if (tabBtn) {
    const tabName = tabBtn.dataset["tab"];
    const drawer = tabBtn.closest<HTMLElement>(".drawer");
    if (drawer && tabName) {
      drawer.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.remove("active"));
      tabBtn.classList.add("active");
      drawer.querySelectorAll<HTMLElement>(".tab-body").forEach((body) => {
        body.hidden = body.dataset["tab"] !== tabName;
      });
    }
    return;
  }

  // 2. Local: close-drawer.
  const closeBtn = target.closest<HTMLElement>('[data-action="close-drawer"]');
  if (closeBtn) {
    const drawer = document.querySelector(".drawer");
    if (drawer) drawer.remove();
    return;
  }

  // 3. Host-bound action delegation (verbatim from old main.ts).
  const btn = target.closest<HTMLElement>("[data-action]");
  if (btn) {
    const id = btn.dataset["id"];
    const action = btn.dataset["action"];
    if (!id) return;
    if (action === "stop") {
      vscode.postMessage({ type: "stop", agentId: id });
    } else if (action === "merge") {
      vscode.postMessage({ type: "merge", agentId: id });
    } else if (action === "discard") {
      vscode.postMessage({ type: "discard", agentId: id });
    } else if (action === "approve" || action === "deny") {
      const approvalId = btn.dataset["approvalId"];
      if (approvalId) {
        vscode.postMessage({
          type: "approve",
          agentId: id,
          approvalId,
          decision: action === "approve" ? "allow" : "deny",
        });
      }
    } else if (action === "resolve-conflict") {
      vscode.postMessage({ type: "resolve-conflict", agentId: id });
    } else if (action === "finish-merge") {
      vscode.postMessage({ type: "finish-merge", agentId: id });
    } else if (action === "create-pr") {
      vscode.postMessage({ type: "create-pr", agentId: id });
    } else if (action === "retry-cleanup") {
      vscode.postMessage({ type: "retry-cleanup", agentId: id });
    }
    return;
  }

  // 4. Focus on card click — post focus message for focused card.
  const card = target.closest<HTMLElement>(".card");
  const cardId = card?.dataset["id"];
  if (cardId) vscode.postMessage({ type: "focus", agentId: cardId });
});

// ─── Composer input delegation ────────────────────────────────────────────────

document.addEventListener("input", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  const action = (target as HTMLInputElement | HTMLTextAreaElement).dataset["action"];
  if (!action) return;

  if (action === "new-role") {
    const value = (target as HTMLInputElement).value;
    composerForm.newRoleName = value || undefined;
    if (value) {
      // deselect any preset chip
      delete composerForm.roleName;
      document.querySelectorAll<HTMLElement>(".composer-chip").forEach((chip) => chip.classList.remove("selected"));
    }
    syncDispatchButton();
  } else if (action === "goal") {
    composerForm.goal = (target as HTMLInputElement).value || undefined;
  } else if (action === "task") {
    composerForm.description = (target as HTMLTextAreaElement).value;
    syncDispatchButton();
  }
});

vscode.postMessage({ type: "ready" });

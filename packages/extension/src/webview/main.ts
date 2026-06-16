import type { CockpitState, HostToWebview, WebviewToHost } from "@maestro/cockpit";
import { renderBoard, renderDrawer } from "../render.js";

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

function render(state: CockpitState): void {
  if (!root) return;
  const board = state.cards.length
    ? renderBoard(state)
    : `<p class="empty">No agents yet. Use the Roster's + (Spawn Agent) to start one.</p>`;
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

window.addEventListener("message", (e: MessageEvent<HostToWebview>) => {
  if (e.data.type === "state") render(e.data.state);
});

// Steer + send-back forms.
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

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

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

vscode.postMessage({ type: "ready" });

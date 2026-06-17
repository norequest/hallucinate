import type { HostToAnatomy, AnatomyToHost, AnatomyVM } from "../anatomy-protocol.js";
import { renderAnatomyRail, renderAnatomyCanvas } from "../anatomy-render.js";
// ToolGrant builtins use narrow literal-union arrays; we cast from string[] after
// reading checkboxes whose data-tool values are already constrained by the renderer.
import type { ToolGrant } from "@maestro/core";
type ReadTool = "Read" | "Search";
type WriteTool = "Edit" | "Run" | "Git";

interface VsCodeApi {
  postMessage(msg: AnatomyToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

// ─── Local state ──────────────────────────────────────────────────────────────

let currentRoleName = "";

// ─── Render ───────────────────────────────────────────────────────────────────

function render(vm: AnatomyVM): void {
  if (!root) return;
  root.innerHTML = renderAnatomyRail(vm) + renderAnatomyCanvas(vm);
  currentRoleName = vm.roleName;
}

// ─── Host message listener ────────────────────────────────────────────────────

window.addEventListener("message", (e: MessageEvent<HostToAnatomy>) => {
  const data = e.data;
  switch (data.type) {
    case "anatomy-state":
      render(data.vm);
      break;
    default: {
      break;
    }
  }
});

// ─── Click delegation ─────────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  // Rail row click: scroll matching canvas section into view
  const railRow = target.closest<HTMLElement>(".anatomy-rail-row[data-section]");
  if (railRow) {
    const section = railRow.dataset["section"];
    if (section) {
      const canvasSection = document.querySelector<HTMLElement>(
        `.anatomy-canvas [data-section="${CSS.escape(section)}"]`,
      );
      canvasSection?.scrollIntoView({ behavior: "smooth" });
    }
    return;
  }

  // Autonomy button
  const autonomyBtn = target.closest<HTMLElement>(
    '.anatomy-autonomy-btn[data-action="role-set-autonomy"][data-value]',
  );
  if (autonomyBtn) {
    const value = autonomyBtn.dataset["value"] as "manual" | "auto-approve-safe" | "yolo";
    vscode.postMessage({ type: "role-set-autonomy", roleName: currentRoleName, autonomy: value });
    return;
  }

  // Grant "grant" button
  const grantBtn = target.closest<HTMLElement>(
    '[data-action="grant"][data-skill][data-tool][data-write]',
  );
  if (grantBtn) {
    const tool = grantBtn.dataset["tool"] ?? "";
    const write = grantBtn.dataset["write"] === "true";
    vscode.postMessage({ type: "grant-tool", roleName: currentRoleName, tool, write });
    return;
  }

  // "attach-anyway" button: remove closest grant gate from DOM
  if (target.closest<HTMLElement>('[data-action="attach-anyway"]')) {
    target.closest(".anatomy-grant-gate")?.remove();
    return;
  }

  // "cancel-grant" button: remove closest grant gate from DOM
  if (target.closest<HTMLElement>('[data-action="cancel-grant"]')) {
    target.closest(".anatomy-grant-gate")?.remove();
    return;
  }
});

// ─── Checkbox change delegation (tool toggles) ────────────────────────────────

document.addEventListener("change", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (
    !target.classList.contains("anatomy-tool-read") &&
    !target.classList.contains("anatomy-tool-write")
  ) {
    return;
  }

  const grid = target.closest(".anatomy-tools-grid");
  if (!grid) return;

  const checkboxes = grid.querySelectorAll<HTMLInputElement>(
    "input[type='checkbox'].anatomy-tool-read, input[type='checkbox'].anatomy-tool-write",
  );

  const readTools: ReadTool[] = [];
  const writeTools: WriteTool[] = [];

  checkboxes.forEach((cb) => {
    if (!cb.checked) return;
    const toolName = cb.dataset["tool"];
    if (!toolName) return;
    if (cb.dataset["mode"] === "write") {
      writeTools.push(toolName as WriteTool);
    } else {
      readTools.push(toolName as ReadTool);
    }
  });

  const tools: ToolGrant = { builtins: { read: readTools, write: writeTools } };
  vscode.postMessage({ type: "role-set-tools", roleName: currentRoleName, tools });
});

// ─── Blur delegation (soul + instructions textareas) ─────────────────────────

document.addEventListener(
  "blur",
  (e) => {
    const target = e.target;
    if (!(target instanceof HTMLTextAreaElement)) return;

    const action = target.dataset["action"];
    if (action === "role-set-soul") {
      vscode.postMessage({ type: "role-set-soul", roleName: currentRoleName, soul: target.value });
    } else if (action === "role-set-instructions") {
      vscode.postMessage({
        type: "role-set-instructions",
        roleName: currentRoleName,
        instructions: target.value,
      });
    }
  },
  { capture: true },
);

// NOTE: The panel sends anatomy-state on reveal; no need to post "open-anatomy" at startup.

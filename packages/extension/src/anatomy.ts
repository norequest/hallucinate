import * as vscode from "vscode";
import { countGrants } from "@maestro/core";
import { skillNeedsGrant } from "@maestro/config";
import type { AdoptDraft } from "@maestro/config";
import { createAnatomyController } from "./anatomy-controller.js";
import { getAnatomyHtml, makeNonce } from "./anatomy-html.js";
import { isAnatomyMessage } from "./anatomy-protocol.js";
import type { AnatomyVM } from "./anatomy-protocol.js";
import type { AnatomyGateway } from "./anatomy-controller.js";

/**
 * Singleton Anatomy editor webview panel.
 * Mirrors LibraryWebviewPanel: full-screen panel, CSP/nonce, isAnatomyMessage
 * guard, and a createAnatomyController wired to push snapshots into the webview.
 *
 * Usage:
 *   const panel = new AnatomyWebviewPanel(context.extensionUri, gateway);
 *   await panel.open("Implementer");
 */
export class AnatomyWebviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly controller: ReturnType<typeof createAnatomyController>;
  private readonly gateway: AnatomyGateway;

  constructor(
    private readonly extensionUri: vscode.Uri,
    gateway: AnatomyGateway,
  ) {
    this.gateway = gateway;
    this.controller = createAnatomyController(
      gateway,
      (vm) => {
        void this.panel?.webview.postMessage({ type: "anatomy-state", vm });
      },
      (message) => {
        void vscode.window.showWarningMessage(`Maestro Anatomy: ${message}`);
      },
    );
  }

  /** Reveal or create the panel, then load the given role name. */
  async open(roleName: string): Promise<void> {
    this.reveal();
    await this.controller.handle({ type: "open-anatomy", roleName });
  }

  /**
   * Reveal or create the panel and display an adopt draft WITHOUT writing to disk.
   * The draft is shown pre-filled so the user can review before saving via Save.
   */
  async openDraft(draft: AdoptDraft): Promise<void> {
    this.reveal();
    // Build a minimal AnatomyVM from the draft role without persisting.
    const skillReqs = await this.gateway.loadSkillRequirements();
    const role = draft.role;
    const toolsSummary = countGrants(role.tools);
    const skills = (role.skills ?? []).map((name) => {
      const req = skillReqs.find((s) => s.name === name);
      const gap = skillNeedsGrant(req?.allowedTools, role.tools);
      return { name, allowedTools: req?.allowedTools, gap };
    });
    const vm: AnatomyVM = {
      roleName: role.name,
      instructions: role.instructions,
      engineId: role.engine.id,
      model: role.engine.model,
      autonomy: role.autonomy,
      soulName: role.soul,
      soulBody: "", // adopt draft has no soul yet
      tools: role.tools,
      toolsSummary,
      skills,
    };
    void this.panel?.webview.postMessage({ type: "anatomy-state", vm });
  }

  private reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "maestro.anatomy",
      "Agent Anatomy",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      },
    );
    this.panel = panel;

    const webview = panel.webview;
    const scriptUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "anatomy-main.js"),
      )
      .toString();
    const styleUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "anatomy.css"),
      )
      .toString();
    webview.html = getAnatomyHtml(scriptUri, styleUri, makeNonce(), webview.cspSource);

    panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (isAnatomyMessage(msg)) {
        void this.controller.handle(msg);
      }
    });

    panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }
}

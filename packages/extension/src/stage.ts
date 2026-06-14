import * as vscode from "vscode";
import type { CockpitState, WebviewToHost } from "@maestro/cockpit";
import { getStageHtml, makeNonce } from "./html.js";

/** Singleton Stage webview panel. */
export class StageWebviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private lastState: CockpitState = { cards: [] };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (msg: WebviewToHost) => void,
  ) {}

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel("maestro.stage", "Maestro Stage", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    });
    this.panel = panel;
    const webview = panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js")).toString();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "style.css")).toString();
    webview.html = getStageHtml(scriptUri, styleUri, makeNonce(), webview.cspSource);
    panel.webview.onDidReceiveMessage((msg: WebviewToHost) => this.onMessage(msg));
    panel.onDidDispose(() => { this.panel = undefined; });
    this.post(this.lastState);
  }

  post(state: CockpitState): void {
    this.lastState = state;
    void this.panel?.webview.postMessage({ type: "state", state });
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }
}

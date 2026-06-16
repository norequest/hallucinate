import * as vscode from "vscode";
import { isWebviewMessage, type CockpitState, type ComposerOptions, type WebviewToHost } from "@maestro/cockpit";
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
    // The webview is a separate, untrusted JS context. Validate every inbound
    // payload at the boundary and drop anything that is not a real
    // WebviewToHost before forwarding it to the controller.
    panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (isWebviewMessage(msg)) this.onMessage(msg);
    });
    panel.onDidDispose(() => { this.panel = undefined; });
    // Best-effort first paint. The webview's own "ready" message (sent once its
    // script loads) is the guaranteed delivery: this early post may be dropped
    // if the webview has not yet attached its message listener.
    this.post(this.lastState);
  }

  post(state: CockpitState): void {
    this.lastState = state;
    void this.panel?.webview.postMessage({ type: "state", state });
  }

  postComposer(options: ComposerOptions): void {
    void this.panel?.webview.postMessage({ type: "composer-options", options });
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }
}

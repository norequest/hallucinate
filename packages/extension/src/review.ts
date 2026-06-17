import * as vscode from "vscode";
import { isWebviewMessage, type CardVM, type WebviewToHost } from "@maestro/cockpit";
import { getReviewHtml, makeNonce } from "./html.js";

/** Options forwarded to review-render when opening or refreshing a card. */
export interface ReviewOpenOpts {
  prMode?: boolean;
  prDraft?: boolean;
  retainBranch?: boolean;
}

/** Host-to-review message telling the webview which card to render. */
export interface HostToReview {
  type: "review-state";
  card: CardVM;
  opts: ReviewOpenOpts;
}

/** Singleton full-width review webview panel. */
export class ReviewWebviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private lastReviewState: HostToReview | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (msg: WebviewToHost) => void,
  ) {}

  /** Open or reveal the panel for the given card. Re-posts the state on reveal
   *  so the webview always shows the latest card data. */
  open(card: CardVM, opts: ReviewOpenOpts = {}): void {
    const state: HostToReview = { type: "review-state", card, opts };
    this.lastReviewState = state;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      void this.panel.webview.postMessage(state);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "maestro.review",
      `Review: ${card.roleName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      },
    );
    this.panel = panel;

    const webview = panel.webview;
    const nonce = makeNonce();
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "review-main.js"))
      .toString();
    webview.html = getReviewHtml(scriptUri, nonce, webview.cspSource);

    // Validate every inbound payload before forwarding to the shared cockpit handler.
    panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (isWebviewMessage(msg)) {
        // "ready" re-sends the last review state to handle first-paint timing.
        if (msg.type === "ready") {
          if (this.lastReviewState) {
            void panel.webview.postMessage(this.lastReviewState);
          }
          return;
        }
        this.onMessage(msg);
      }
    });

    panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // Best-effort early post; the "ready" message guarantees delivery.
    void webview.postMessage(state);
  }

  /** Re-post the current review state (e.g., when the underlying card updates). */
  refresh(card: CardVM, opts: ReviewOpenOpts = {}): void {
    if (!this.panel) return;
    const state: HostToReview = { type: "review-state", card, opts };
    this.lastReviewState = state;
    void this.panel.webview.postMessage(state);
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }
}

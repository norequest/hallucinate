const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Deterministic-length random nonce. Runs in the extension host (Math.random allowed). */
export function makeNonce(): string {
  let s = "";
  for (let i = 0; i < 32; i++) {
    s += NONCE_ALPHABET.charAt(Math.floor(Math.random() * NONCE_ALPHABET.length));
  }
  return s;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The webview shell. scriptUri/styleUri are webview-safe URIs; cspSource is webview.cspSource. */
export function getStageHtml(scriptUri: string, styleUri: string, nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Maestro Stage</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

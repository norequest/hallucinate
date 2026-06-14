import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("maestro.openStage", () => {
      vscode.window.showInformationMessage("Maestro: stage coming online.");
    }),
  );
}

export function deactivate(): void {
  // no-op
}

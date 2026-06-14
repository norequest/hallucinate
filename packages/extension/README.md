# Maestro (VS Code extension)

Conduct a team of AI coding agents in isolated git worktrees.

## Develop / run (F5)
1. `pnpm install` at the repo root.
2. Build the libraries + extension: `pnpm -r build` (the four `@maestro/*` libraries build first, then this extension's esbuild bundles).
3. Open `packages/extension` in VS Code and press **F5** (Run Extension). A second VS Code window opens with Maestro in the activity bar.
4. Open a **git repo** folder in that window. Click the Maestro rocket in the activity bar, open the **Roster**, click the title-bar **+** (Spawn Agent), and type a task. Watch the Stage stream the agent's output; on done, review the diff and click **Merge** or **Discard**.

Requires the GitHub `copilot` CLI on your PATH and a Copilot subscription (the engine reuses your `gh` / Copilot auth, no API key needed).

## Build outputs
- `dist/extension.js` — the extension host (CJS bundle, `vscode` external)
- `dist/webview/main.js` + `dist/webview/style.css` — the Stage webview client

## Architecture
The extension is a thin shell over pure, unit-tested packages:
- `@maestro/core` — the orchestrator state machine
- `@maestro/cockpit` — the pure presenter (events to renderable state)
- `@maestro/workspace` — real git worktree isolation + merge
- `@maestro/adapter-copilot` — the Copilot CLI engine adapter

`src/controller.ts`, `src/roster-map.ts`, and `src/html.ts`/`src/render.ts` hold the testable logic; `src/extension.ts`, `src/roster.ts`, and `src/stage.ts` are the VS Code glue.

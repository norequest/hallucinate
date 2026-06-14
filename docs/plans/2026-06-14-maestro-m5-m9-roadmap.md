# Maestro M5-M9: Shared Decomposition (read before writing any M5-M9 plan)

**Date:** 2026-06-14
**Purpose:** This is the shared contract every M5-M9 implementation plan is written against. It pins the CURRENT public APIs (after M4 merged to `main`), each milestone's scope boundary, the dependency order, and the cross-milestone seams. Read this first, then your milestone's section, then the relevant existing code, then write your plan. Following it is what keeps the parallel-authored plans mutually consistent.

The overall product design lives in `docs/plans/2026-06-14-maestro-vscode-design.md`. M1-M4 are DONE and merged; their plans are in `docs/plans/`.

---

## Current state (what exists on `main` today)

Five packages in a pnpm workspace (`packages/*`), all ESM/NodeNext, `"strict": true` + `"noUncheckedIndexedAccess": true`, Vitest, TDD. Build: each library is `tsc -p tsconfig.build.json`; the extension is bundled by esbuild. Full gate today: **112 tests** (core 47, cockpit 12, adapter-copilot 20, workspace 17, extension 16).

### `@maestro/core` (pure orchestration brain, zero runtime deps)
Public API (`packages/core/src/index.ts`):
- `class Orchestrator` — constructor `(config: OrchestratorConfig, workspaces: WorkspaceProvider, idGen?: () => string)`. Methods: `registerAdapter(adapter)`, `registerRole(role)`, `on(listener: (e: OrchestratorEvent) => void): () => void`, `getAgents(): Agent[]`, `getAgent(id): Agent | undefined`, `spawn(roleName, description): Agent`, `approve(agentId, approvalId, decision: ApprovalDecision)`, `steer(agentId, input)`, `stop(agentId)`, `merge(agentId): Promise<MergeResult>`, `discard(agentId): Promise<void>`.
- Types (`types.ts`): `Task {id, description, roleName}`, `Workspace {agentId, path, branch}`, `Diff {files, patch}`, `MergeResult = {status:"clean"} | {status:"conflict", files}`, `Capabilities {streaming, structuredEvents, approvals, steerable}`, `AgentState = "preparing"|"working"|"awaiting-approval"|"done"|"error"|"stopped"|"merged"|"discarded"|"conflict"`, `EngineState = "working"|"awaiting-approval"`, `AgentEvent = {kind:"output",text} | {kind:"action",tool,detail} | {kind:"approval",id,detail} | {kind:"status",state:EngineState} | {kind:"done",summary,diff?} | {kind:"error",message}`, `Role {name, instructions, engine:{id,model?}, autonomy:"manual"|"auto-approve-safe"|"yolo"}`, `Agent {id, task, role, state, log:AgentEvent[], summary?, diff?, conflict?:{files}, diffError?, error?, pendingApprovalId?, workspace?}`, `OrchestratorEvent = {kind:"agent-added",agent} | {kind:"agent-updated",agent} | {kind:"agent-event",agentId,event}`, `OrchestratorConfig {maxParallelAgents}`. **NOTE: there is no `Team` type in core yet.**
- Adapter contract (`adapter.ts`): `EngineAdapter {id, capabilities, start(task, workspace, role): AgentSession, health(): Promise<HealthStatus>}`, `AgentSession {events: AsyncIterable<AgentEvent>, send(input), respond(approvalId, decision), stop()}`, `ApprovalDecision = "allow"|"deny"`, `HealthStatus {ok, detail?}`.
- Test doubles + utils: `FakeEngineAdapter`, `FakeSession`, `FakeWorkspaceProvider`, `FakeWorkspaceManager`, `isWorkspaceManager`, `Emitter`, `EventQueue`, `isTerminalState`, `WorkspaceProvider` (`create(agentId):Promise<Workspace>`, `cleanup(agentId):Promise<void>`), `WorkspaceManager extends WorkspaceProvider` (`diff(agentId):Promise<Diff>`, `merge(agentId):Promise<MergeResult>`, `discard(agentId):Promise<void>`).
- Orchestrator internals worth knowing: it queues spawns past `maxParallelAgents` (queued agents sit in `preparing`), computes diff-on-done when `event.diff===undefined` and the provider `isWorkspaceManager`, calls `cleanup()` ONLY on merge(clean)/discard (never on terminal stream end), and `merge()` sets non-terminal `conflict` on an unmerged result.

### `@maestro/workspace`
- `class GitWorkspaceManager implements WorkspaceManager` — constructor `({ repoRoot: string, runner?: GitRunner })`. `create` builds a worktree at `.conductor/wt/<agentId>` on branch `agent/<slug>` off `rev-parse HEAD`; `diff` snapshots dirty work then `git diff baseSha HEAD`; `merge` does `git merge --no-commit --no-ff` then commit (clean) or detects unmerged `--diff-filter=U` files (conflict, abort) vs a real failure (throw); `cleanup`/`discard` tear down worktree+branch.
- Exports: `GitWorkspaceManager`, `GitWorkspaceManagerOptions`, `nodeGitRunner`, `GitRunner = (args: readonly string[], opts?: {cwd?}) => Promise<GitResult>`, `GitResult {exitCode, stdout, stderr}`.
- Injectable-runner pattern: logic is unit-tested with a fake `GitRunner` asserting exact arg arrays; real git only in integration tests.

### `@maestro/adapter-copilot`
- `class CopilotAdapter implements EngineAdapter` — constructor `({ spawn?: SpawnFn, env?, command? })`. Spawns `copilot` per worktree, streams stdout to `output` events, exit 0 → done / non-zero → error, `stop()` kills. Capabilities `{streaming:true, structuredEvents:false, approvals:false, steerable:false}`. Auth via GitHub token (no API key).
- Exports: `CopilotAdapter`, `CopilotAdapterOptions`, `COPILOT_CAPABILITIES`, `resolveAuth`, `buildArgs`, `cleanOutput`, `ChildHandle`, `SpawnFn`.
- Injectable `spawn` (`SpawnFn`) makes the adapter fully offline-testable; conformance is verified through a real `Orchestrator`.

### `@maestro/cockpit` (pure presenter, no VS Code)
- Exports: `CardVM` (id, roleName, engineId, state, output, summary?, diff?, diffError?, conflictFiles?, error?, pendingApprovalId?, attention), `CockpitState {cards, focusedId?}`, `HostToWebview = {type:"state",state}`, `WebviewToHost = {type:"ready"} | {type:"focus",agentId} | {type:"spawn",roleName,description} | {type:"steer",agentId,input} | {type:"approve",agentId,approvalId,decision:"allow"|"deny"} | {type:"stop",agentId} | {type:"merge",agentId} | {type:"discard",agentId}`, `initialModel()`, `reduce(model, OrchestratorEvent): CockpitModel`, `selectState(model): CockpitState` (attention-first ordering), `setFocus`, `OUTPUT_CAP=16000`, `CockpitModel`.
- **The approve/steer messages already exist in the protocol** (added in M4 for forward-compat); the UI controls for them are NOT built yet (Copilot can't use them). `CardVM.pendingApprovalId` is already populated by the reducer.

### `@maestro/extension` (the real VS Code extension, esbuild-bundled)
- Files: `controller.ts` (`createCockpit(orch, onState, onError?)`, `OrchestratorLike`, `Cockpit`), `roster-map.ts` (`cardIcon`, `cardToRosterItem`, `RosterItem` — pure, vscode-free), `roster.ts` (`RosterTreeDataProvider`, Disposable), `html.ts` (`makeNonce` via Web Crypto, `escapeHtml`, `getStageHtml` — pure), `render.ts` (`renderCardHTML` — pure, escapes all engine text), `stage.ts` (`StageWebviewPanel`), `extension.ts` (`activate`/`deactivate`), `webview/main.ts` (vanilla-TS client), `webview/style.css`. Manifest: activity-bar container `maestro` → Roster TreeView `maestro.roster`; commands `maestro.spawnAgent`/`maestro.openStage` (+ runtime `maestro.focusAgent`); icon `resources/maestro.svg`.
- **The mandatory testing pattern:** files that `import "vscode"` cannot be loaded under Vitest (no `vscode` module at runtime). So all testable logic lives in vscode-free files (`controller.ts`, `roster-map.ts`, `html.ts`, `render.ts`) and is unit-tested; the vscode-importing files (`roster.ts`, `stage.ts`, `extension.ts`) are thin glue verified by typecheck + esbuild build + manual F5. tsconfig is `moduleResolution: bundler`, `noEmit`; esbuild bundles host (CJS, `vscode` external) + webview (browser IIFE).

---

## Conventions every plan must follow

1. **Format:** follow the `superpowers:writing-plans` shape — a header block (Goal / Architecture / Tech Stack), a File Structure section, then bite-sized TDD tasks (`- [ ]` steps: write failing test, run it red, implement, run green, commit), and a Self-Review checklist. Put REAL code in steps (no "TBD"/"add error handling" placeholders). Exact file paths always.
2. **TDD + tests offline:** every logic unit is unit-tested with no network and no real CLI, using the injectable-dependency pattern (`SpawnFn`/`GitRunner`-style fakes). Real CLIs/git only in clearly-separated integration tests.
3. **Package conventions:** new packages mirror `packages/workspace` (package.json scripts, `tsconfig.json` + `tsconfig.build.json`, `vitest.config.ts`); ESM, NodeNext, strict + noUncheckedIndexedAccess; `@maestro/core: workspace:*` dep as needed. New extension-side webview/host code follows the pure/vscode file split above and is bundled by esbuild (extend `build.mjs` if a new entrypoint is needed).
4. **Commits:** one commit per task, message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. (The plan describes the commits; whoever executes runs them.)
5. **No em dashes** anywhere in plan prose, code, comments, or commit messages. Use commas/periods/colons; middot `·` is allowed.
6. **Save your plan to** `docs/plans/2026-06-14-maestro-m<N>-<slug>.md`. Do NOT git-commit it (the orchestrator commits all plans together after reconciliation). Do NOT modify any other file.
7. **Additive-against-current-main rule (critical for parallel consistency):** several milestones extend the SAME shared files. Write your changes to shared files as ADDITIVE DELTAS against the current merged `main` described above. Do NOT rewrite an entire shared file, and do NOT assume your milestone is the only one extending it. For any capability you depend on from an earlier milestone (e.g. M6 depends on M5's ACP adapter emitting approvals), put it in an explicit **"Upstream assumptions / contract"** section at the top of your plan so it can be reconciled.

---

## Milestone decomposition (scope boundaries, deps, owned files, seams)

Dependency order: M5 → M6 (chain). M7, M8, M9 are mutually independent and independent of M5/M6 (they share some files, handled by the additive rule).

### M5 — Parallelism + the generic ACP adapter  ·  slug: `m5-acp-adapter`
**Headline:** prove model-agnosticism with a SECOND engine via a different protocol, and prove agents run in parallel.
**IN:** a new `@maestro/adapter-acp` package — a generic ACP (Agent Client Protocol, JSON-RPC-over-stdio) adapter that drives `gemini --acp` and `copilot --acp --stdio` (one adapter, multiple engines). It speaks ACP yourself or via `@agentclientprotocol/sdk` (your call; prefer an injectable transport so it is offline-testable with fixtures, mirroring `SpawnFn`). Translate ACP messages into the common `AgentEvent` stream INCLUDING real `approval` events (from ACP `requestPermission`) and `status` events; implement `AgentSession.respond()` (answers the ACP permission), `send()` (steers via a follow-up prompt turn), `stop()`. Capabilities `{streaming:true, structuredEvents:true, approvals:true, steerable:true}`. Map `Role.autonomy` to an ACP permission mode (manual → ask, auto-approve-safe → a safe pre-authorized mode, yolo → allow-all). A shared **adapter conformance suite** (the design's "contract guard"): one suite that every adapter must pass (emits >=1 status, terminates done|error, honors stop(), reports capabilities truthfully) — make Copilot AND ACP adapters pass it; you choose where it lives (a `packages/conformance` dev package, or a core test export) but state it. A parallel-run e2e (multiple agents concurrently through a real `Orchestrator` with fakes), and surfacing queued agents in the roster (they are already `preparing`; just confirm they render).
**OUT (later milestones):** the approval/steering UI controls (M6 — M5 makes approvals POSSIBLE; with no UI, run ACP in a pre-authorized autonomy so nothing blocks). Persistence (M7). YAML config (M8). Merge robustness (M9). Codex native-SDK and aider blind adapters (future, not in this batch).
**Owned files:** new `packages/adapter-acp/**`; optionally new `packages/conformance/**`; extension `activate()` may register the ACP adapter alongside Copilot (additive delta). May add nothing to core (the contract already supports approvals/steer).
**Seam to M6:** document the exact shape of the `approval` event `detail` (what the UI will render) and confirm `respond()`/`send()` semantics, since M6 builds the UI on these.

### M6 — Approvals + steering UI  ·  slug: `m6-approvals-steering`  ·  depends on M5
**IN:** the cockpit/extension UI for interactive control, now that an engine (ACP) actually emits approvals and is steerable. Render approve/deny buttons on a card when `CardVM.pendingApprovalId` is set (+ show the approval detail); a steering input box that posts `{type:"steer"}`; "send back with feedback" on a done/conflict card. The `approve`/`steer` protocol messages and the controller dispatch already exist (M4) — you are adding the UI controls + surfacing approval detail in `CardVM`. **Send-back** needs a NEW core capability: an agent whose session has ended (done/conflict) has no live session, so reopening it requires the orchestrator to re-start the agent in the SAME worktree with the feedback appended — add `Orchestrator.sendBack(agentId, feedback)` (additive). Update the reducer to clear `pendingApprovalId` appropriately and to carry approval `detail` into `CardVM`.
**OUT:** the adapter that emits approvals (M5). Persistence/config/merge-robustness.
**Owned files (additive deltas):** `core/src/orchestrator.ts` (+`sendBack`), `core/src/types.ts` (maybe an `approvalDetail?` on `Agent`/`CardVM`), `cockpit/src/protocol.ts` (+ optional `WebviewToHost` `sendBack` message + `CardVM.approvalDetail`), `cockpit/src/reducer.ts` (carry approval detail), extension `render.ts` + `webview/main.ts` (the controls), extension `controller.ts` (+ sendBack dispatch), extension `activate()`.
**Upstream assumption to state:** M5's ACP adapter emits `approval` events with a renderable `detail` and honors `respond()`/`send()`.

### M7 — Persistence + rehydration  ·  slug: `m7-persistence`  ·  independent
**IN:** survive a VS Code reload. Persist per-agent records + a per-agent JSONL event log to a gitignored `.conductor/.runtime/` plus VS Code `workspaceState`. On `activate`, rehydrate agent records and replay each JSONL to reconstruct cockpit state (the UI is a pure function of events, so replay reconstructs cards), then reattach to live child processes where possible, else mark agents "detached, worktree preserved." Persistence writes are driven off the orchestrator's `on()` event stream (append each `agent-event`/`agent-updated`).
**Core seam:** the orchestrator is currently spawn-only; rehydration needs a way to restore agent records without re-spawning — add an additive `Orchestrator.hydrate(records)` (or an injected store + replay) and likely a new additive `AgentState` value `"detached"` (mirror how M3 added `conflict`: a Set-based `isTerminalState`, no exhaustive switch to break). Decide and state the exact shape.
**OUT:** the ACP adapter, approval UI, YAML config, merge robustness.
**Owned files (additive deltas):** a new persistence module (either `packages/persistence/**` or `extension/src/persistence.ts` — choose and justify; the JSONL/store logic should be pure + unit-tested, the `workspaceState`/fs wiring thin), `core/src/orchestrator.ts` (+hydrate), `core/src/types.ts` (maybe `"detached"` state), extension `activate()` (load on start, subscribe-to-save).
**Note:** `.conductor/.runtime/` is already in `.gitignore`.

### M8 — Roles/Teams as `.conductor/` YAML  ·  slug: `m8-yaml-config`  ·  independent
**IN:** versioned, shareable agent setup. A new `@maestro/config` package that reads/writes `.conductor/teams/*.yaml`, `.conductor/roles/*.yaml`, `.conductor/config.yaml` (use the `yaml` dep) and produces `Role[]` + `Team[]` + `OrchestratorConfig`. Validate shape (a small schema/validator, no heavy dep). The extension loads roles on activate (replacing the hardcoded `DEFAULT_ROLE`), the spawn command shows a role QuickPick, and a first-run scaffolder writes starter YAML if `.conductor/` has none. **Core has no `Team` type yet** — add `Team {name, roles: Role[]}` to core (additive) or define it in config; state your choice.
**OUT:** ACP adapter, approval UI, persistence, merge robustness.
**Owned files (additive deltas):** new `packages/config/**`; `core/src/types.ts` (+`Team`, if you put it in core); extension `activate()` (load roles, role-picker in the spawn command). Parsing/validation logic is pure + unit-tested with fixture YAML; fs reads are thin.

### M9 — Merge robustness  ·  slug: `m9-merge-robustness`  ·  independent
**IN:** make merge production-grade. (a) Serialized-merge mutex: the orchestrator merges one agent at a time so concurrent `merge()` calls cannot race (an internal lock/queue in `Orchestrator.merge`). (b) Stale-base/rebase: detect that `main`/HEAD advanced past an agent's `baseSha` and offer a one-click rebase of the agent branch before merge — add workspace `isStale(agentId): Promise<boolean>` and `rebase(agentId): Promise<MergeResult>`. (c) Conflict-resolve-in-editor: on a `conflict` card, open the conflicted files in VS Code's merge editor and, on resolution, finish the merge — workspace `resolveMerge(agentId)` + extension UI. (d) PR/remote-merge mode: a config toggle to push the agent branch and `gh pr create` instead of a local merge — workspace path + extension surfacing. (e) Branch-retention policy. Also closes M3's tracked half-applied-state risk (cleanup rejects after a clean merge) by making the merge→cleanup→state transition robust.
**OUT:** ACP adapter, approval UI, persistence, YAML config.
**Owned files (additive deltas):** `workspace/src/git-workspace-manager.ts` (+`isStale`, `rebase`, `resolveMerge`, PR-mode, retention; all via the injectable `GitRunner`, unit-tested with a fake runner + integration-tested on real repos), `core/src/orchestrator.ts` (merge mutex; harden merge→cleanup), extension `render.ts`/`webview` + `activate()` (conflict-resolve + PR-mode UI). Keep the "real conflict vs real failure" discrimination M3 established.

---

## Shared-file reconciliation map (so the parallel plans do not collide)

These files are extended by multiple milestones. Each plan writes ADDITIVE deltas only:
- `core/src/types.ts` `AgentState` union: M7 may add `"detached"`. `Team` type: M8 may add. (Additive, like M3's `conflict`.)
- `core/src/orchestrator.ts`: M6 `+sendBack`, M7 `+hydrate`, M9 merge-mutex + harden. Distinct additive methods.
- `cockpit` (`protocol.ts`/`reducer.ts`): M6 adds approval detail (+ maybe a `sendBack` message).
- `extension/src/extension.ts` `activate()`: M5 (register ACP adapter), M6 (approve/steer/sendBack), M7 (load/save), M8 (load roles + role picker), M9 (conflict-resolve + PR mode). EVERY plan describes its activate() additions as deltas, never a rewrite.
- `extension/src/render.ts` + `webview/main.ts`: M6 (approval/steer/send-back controls), M9 (conflict-resolve button). Additive.

When these milestones are later implemented one at a time, the orchestrator merges the deltas; the plans just must not assume sole ownership of a shared file.

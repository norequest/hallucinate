# Maestro Workspace Manager Implementation Plan (Milestone 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn streamed agent runs into the review-the-diff product. Give each agent a real, isolated **git worktree**; after it finishes, compute the **diff** (the conductor's review surface); let the conductor **merge** (with conflict detection) or **discard**. Done in two phases: Phase A extends the `@maestro/core` contract (backward-compatible, all 55 existing tests stay green); Phase B implements the real git mechanics in a new `@maestro/workspace` package that plugs into the Phase-A seam.

**Architecture:** The orchestrator (M1) already drives the agent lifecycle and calls `workspaces.create()`. M3 adds a feature-detected `WorkspaceManager` capability (extends the existing `WorkspaceProvider`): `diff` / `merge` / `discard`. The orchestrator computes the diff after `done` (only when the adapter supplied none) and exposes `merge`/`discard` that transition the agent to `merged` / `discarded` / `conflict` and call `cleanup()` only on resolution (never on a terminal stream end — the worktree must survive for review). The real implementation, `GitWorkspaceManager`, drives git through an injected `GitRunner` so the logic is unit-testable with a fake runner and integration-testable against throwaway repos.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, pnpm workspace, `node:child_process` (git). Reuses `@maestro/core` types + orchestrator.

---

## Why this milestone, and what it does NOT include

M2 made a real Copilot agent stream and exit, but against a `FakeWorkspaceProvider` (in-memory, no real isolation, no diff). M3 makes the isolation and the review surface real, which is what the "watch parallel agents, review the diff, merge" product actually needs.

**In scope:** real `git worktree` per agent; `cleanup` wired correctly (on resolution); diff-on-done; `merge` (clean merge + conflict detection) and `discard`; a first-class `conflict` state.

**Deferred (tracked, NOT in this plan):** rebase / stale-base drift handling; "send the conflict back to the agent"; serialized-merge mutex (only matters with concurrent merges); PR/remote merge strategy (M3 merges into the current local branch on an explicit Merge action). These are noted at the end as follow-ups.

## Key decisions (from the M3 design pass)

- **Two packages.** Contract + orchestrator wiring in `@maestro/core` (pure, additive). Real git in a new `@maestro/workspace` package (depends on core). Keeps core dependency-free.
- **`cleanup()` on resolution only.** Called inside `orch.merge()` (clean) and `orch.discard()`, never on `done`/`error`/`stopped`. The worktree + diff are the review surface; auto-cleanup on `done` would delete them. (This correctly closes M1's "cleanup never called" flag: it's wired to *resolve*, intentionally deferred from terminal.)
- **Feature-detected capability.** `WorkspaceManager extends WorkspaceProvider` with `diff`/`merge`/`discard`; `isWorkspaceManager(w)` runtime guard. `FakeWorkspaceProvider` stays a plain provider → the guard is `false` → M1/M2 behavior unchanged.
- **diff-on-done is doubly guarded:** runs only when `event.diff === undefined` AND `isWorkspaceManager(workspaces)`. So adapter-supplied diffs are never overwritten and the Fake is a no-op (existing tests green).
- **`conflict` is a new, non-terminal `AgentState`** surfaced via the existing `agent-updated` event (no new `OrchestratorEvent` variant). Verified: no `switch(state)`/`assertNever(state)` in core, `isTerminalState` is a Set lookup → adding a member is type-safe.
- **`GitRunner` injection** (same pattern as the Copilot adapter's `SpawnFn`): logic unit-tested with a fake runner (assert exact arg arrays), real git only in integration tests against temp repos.

## File Structure

```
packages/
  core/
    src/
      types.ts            # MODIFY: AgentState += "conflict"; add MergeResult; Agent.conflict?/diffError?
      workspace.ts        # MODIFY: add WorkspaceManager interface + isWorkspaceManager + FakeWorkspaceManager
      orchestrator.ts     # MODIFY: computeDiff on done; merge()/discard()/canDiscard()
      events.ts           # UNCHANGED ("conflict" intentionally non-terminal)
      index.ts            # MODIFY: export WorkspaceManager, isWorkspaceManager, FakeWorkspaceManager
    test/
      events.test.ts            # MODIFY: assert isTerminalState("conflict") === false
      workspace.test.ts         # NEW: isWorkspaceManager guard + FakeWorkspaceManager
      orchestrator.diff.test.ts # NEW: diff-on-done (computed + regression: adapter diff not overwritten)
      orchestrator.merge.test.ts# NEW: merge/discard/conflict transitions
  workspace/                    # NEW PACKAGE @maestro/workspace
    package.json
    tsconfig.json / tsconfig.build.json
    vitest.config.ts
    src/
      git-runner.ts       # GitRunner type + nodeGitRunner
      git-workspace-manager.ts  # GitWorkspaceManager implements WorkspaceManager
      index.ts
    test/
      fake-git-runner.ts        # shared fake
      git-workspace-manager.unit.test.ts        # fake runner: assert arg arrays
      git-workspace-manager.integration.test.ts # real git in temp repos
      orchestrator-e2e.integration.test.ts      # real worktree driven through the Orchestrator
```

---

# Phase A — Core contract + orchestrator wiring (`@maestro/core`)

All of Phase A keeps the existing 35 core + 20 adapter tests green (additive, feature-detected). Build core after each task (`pnpm --filter @maestro/core build`) so dependents see new types.

### Task A1: Additive types

**Files:** Modify `packages/core/src/types.ts`; Modify `packages/core/test/events.test.ts`.

- [ ] **Step 1: Extend the types**

In `packages/core/src/types.ts`, add `"conflict"` to `AgentState` (after `"discarded"`):

```ts
export type AgentState =
  | "preparing"
  | "working"
  | "awaiting-approval"
  | "done"
  | "error"
  | "stopped"
  | "merged"
  | "discarded"
  | "conflict";
```

Add a `MergeResult` type (near `Diff`):

```ts
/** Outcome of merging an agent's branch. */
export type MergeResult =
  | { status: "clean" }
  | { status: "conflict"; files: string[] };
```

Add two optional fields to the `Agent` interface (after `diff?`):

```ts
  conflict?: { files: string[] };
  diffError?: string;
```

- [ ] **Step 2: Lock "conflict" is non-terminal**

Append to `packages/core/test/events.test.ts` inside the existing `describe("isTerminalState", ...)`:

```ts
  it("treats conflict as non-terminal (it is resolvable)", () => {
    expect(isTerminalState("conflict")).toBe(false);
  });
```

- [ ] **Step 3: Run + build**

Run: `cd packages/core && pnpm vitest run test/events.test.ts` → PASS (existing + 1 new).
Run: `cd packages/core && pnpm vitest run && pnpm exec tsc --noEmit` → all 35+1 pass, clean.
Run: `pnpm --filter @maestro/core build` → dist updates.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/test/events.test.ts
git commit -m "feat(core): add conflict state, MergeResult, optional agent conflict/diffError"
```

---

### Task A2: `WorkspaceManager` capability + guard + fake

**Files:** Modify `packages/core/src/workspace.ts`, `packages/core/src/index.ts`; Create `packages/core/test/workspace.test.ts`.

- [ ] **Step 1: Failing test**

Create `packages/core/test/workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FakeWorkspaceManager,
  FakeWorkspaceProvider,
  isWorkspaceManager,
} from "../src/index.js";

describe("isWorkspaceManager", () => {
  it("is false for a plain WorkspaceProvider", () => {
    expect(isWorkspaceManager(new FakeWorkspaceProvider())).toBe(false);
  });
  it("is true for a WorkspaceManager", () => {
    expect(isWorkspaceManager(new FakeWorkspaceManager())).toBe(true);
  });
});

describe("FakeWorkspaceManager", () => {
  it("records diff/merge/discard/cleanup and returns scripted results", async () => {
    const m = new FakeWorkspaceManager();
    m.setDiff("a1", { files: ["x.ts"], patch: "p" });
    expect(await m.diff("a1")).toEqual({ files: ["x.ts"], patch: "p" });

    m.setMergeResult("a1", { status: "conflict", files: ["x.ts"] });
    expect(await m.merge("a1")).toEqual({ status: "conflict", files: ["x.ts"] });

    await m.discard("a1");
    expect(m.discarded).toContain("a1");
    await m.cleanup("a1");
    expect(m.cleaned).toContain("a1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && pnpm vitest run test/workspace.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Extend workspace.ts**

In `packages/core/src/workspace.ts`, change the type import to include `Diff` and `MergeResult`, and append:

```ts
import type { Diff, MergeResult, Workspace } from "./types.js";

// ... existing WorkspaceProvider + FakeWorkspaceProvider unchanged ...

/**
 * A richer provider the orchestrator FEATURE-DETECTS. Implementing this (real
 * git worktrees) unlocks diff-on-done and merge/discard. The base
 * WorkspaceProvider (e.g. FakeWorkspaceProvider) keeps working unchanged.
 */
export interface WorkspaceManager extends WorkspaceProvider {
  /** Diff of the agent's worktree vs its base; the conductor's review surface. */
  diff(agentId: string): Promise<Diff>;
  /** Merge the agent's branch into the base. Reports clean | conflict. */
  merge(agentId: string): Promise<MergeResult>;
  /** Drop the agent's branch + worktree without merging. */
  discard(agentId: string): Promise<void>;
}

/** Runtime feature-detection guard. */
export function isWorkspaceManager(w: WorkspaceProvider): w is WorkspaceManager {
  const m = w as Partial<WorkspaceManager>;
  return (
    typeof m.diff === "function" &&
    typeof m.merge === "function" &&
    typeof m.discard === "function"
  );
}

/** In-memory WorkspaceManager test double (scriptable). */
export class FakeWorkspaceManager implements WorkspaceManager {
  readonly created: string[] = [];
  readonly cleaned: string[] = [];
  readonly diffed: string[] = [];
  readonly merged: string[] = [];
  readonly discarded: string[] = [];
  private diffs = new Map<string, Diff>();
  private mergeResults = new Map<string, MergeResult>();

  setDiff(agentId: string, diff: Diff): void {
    this.diffs.set(agentId, diff);
  }
  setMergeResult(agentId: string, result: MergeResult): void {
    this.mergeResults.set(agentId, result);
  }

  create(agentId: string): Promise<Workspace> {
    this.created.push(agentId);
    return Promise.resolve({ agentId, path: `/tmp/maestro/${agentId}`, branch: `agent/${agentId}` });
  }
  cleanup(agentId: string): Promise<void> {
    this.cleaned.push(agentId);
    return Promise.resolve();
  }
  diff(agentId: string): Promise<Diff> {
    this.diffed.push(agentId);
    return Promise.resolve(this.diffs.get(agentId) ?? { files: [], patch: "" });
  }
  merge(agentId: string): Promise<MergeResult> {
    this.merged.push(agentId);
    return Promise.resolve(this.mergeResults.get(agentId) ?? { status: "clean" });
  }
  discard(agentId: string): Promise<void> {
    this.discarded.push(agentId);
    return Promise.resolve();
  }
}
```

- [ ] **Step 4: Export from index.ts**

In `packages/core/src/index.ts`, add:

```ts
export { isWorkspaceManager, FakeWorkspaceManager } from "./workspace.js";
export type { WorkspaceManager } from "./workspace.js";
```

(`MergeResult` re-exports automatically via the existing `export * from "./types.js"`.)

- [ ] **Step 5: Run + build**

Run: `cd packages/core && pnpm vitest run test/workspace.test.ts` → PASS.
Run: `cd packages/core && pnpm vitest run && pnpm exec tsc --noEmit` → all pass, clean.
Run: `pnpm --filter @maestro/core build`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/workspace.ts packages/core/src/index.ts packages/core/test/workspace.test.ts
git commit -m "feat(core): add WorkspaceManager capability, feature-detection guard, and fake"
```

---

### Task A3: diff-on-done in the orchestrator

**Files:** Modify `packages/core/src/orchestrator.ts`; Create `packages/core/test/orchestrator.diff.test.ts`.

- [ ] **Step 1: Failing test**

Create `packages/core/test/orchestrator.diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeEngineAdapter, FakeWorkspaceManager, Orchestrator } from "../src/index.js";
import type { Role } from "../src/index.js";

const role: Role = { name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" };

function waitFor(orch: Orchestrator, agentId: string, pred: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => { if (pred()) resolve(); };
    orch.on(check);
    check();
  });
}

describe("Orchestrator diff-on-done", () => {
  it("computes the diff after done when the adapter supplied none", async () => {
    const manager = new FakeWorkspaceManager();
    manager.setDiff("agent-1", { files: ["a.ts"], patch: "diff-text" });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    // adapter emits done WITHOUT a diff
    orch.registerAdapter(
      new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }),
    );

    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, () => orch.getAgent(agent.id)?.diff !== undefined);

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.diff).toEqual({ files: ["a.ts"], patch: "diff-text" });
    expect(manager.diffed).toContain(agent.id);
  });

  it("does not overwrite an adapter-supplied diff", async () => {
    const manager = new FakeWorkspaceManager();
    manager.setDiff("agent-1", { files: ["wrong.ts"], patch: "should-not-appear" });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({
        script: [{ kind: "done", summary: "ok", diff: { files: ["real.ts"], patch: "real" } }],
      }),
    );

    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, () => orch.getAgent(agent.id)?.state === "done");
    await new Promise((r) => setTimeout(r, 0)); // let any async diff settle

    expect(orch.getAgent(agent.id)!.diff).toEqual({ files: ["real.ts"], patch: "real" });
    expect(manager.diffed).not.toContain(agent.id); // computeDiff skipped (diff present)
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && pnpm vitest run test/orchestrator.diff.test.ts` → FAIL (no diff computation yet).

- [ ] **Step 3: Implement computeDiff**

In `packages/core/src/orchestrator.ts`:

(a) Change the workspace import line to also import the guard (value import):

```ts
import { isWorkspaceManager } from "./workspace.js";
import type { WorkspaceProvider } from "./workspace.js";
```

(b) In `applyEvent`, the `done` case — keep the existing two lines, append the guarded call:

```ts
      case "done":
        agent.summary = event.summary;
        agent.diff = event.diff;
        this.update(agent, "done");
        if (event.diff === undefined) this.computeDiff(agent);
        break;
```

(c) Add the private method (near `update`/`fail`):

```ts
  private computeDiff(agent: Agent): void {
    if (!isWorkspaceManager(this.workspaces)) return; // plain provider -> no-op
    const ws = this.workspaces;
    void ws
      .diff(agent.id)
      .then((diff) => {
        if (agent.diff !== undefined) return; // adapter won the race
        agent.diff = diff;
        this.emitter.emit({ kind: "agent-updated", agent });
      })
      .catch((error) => {
        agent.diffError = errorMessage(error);
        this.emitter.emit({ kind: "agent-updated", agent });
      });
  }
```

(`errorMessage` already exists at module scope in orchestrator.ts from M1. `Agent` is already imported.)

- [ ] **Step 4: Run to verify it passes (and regressions stay green)**

Run: `cd packages/core && pnpm vitest run test/orchestrator.diff.test.ts` → PASS (2).
Run: `cd packages/core && pnpm vitest run` → ALL still pass (happy.test diff cases unaffected: the diff-present case skips computeDiff; the no-diff case uses FakeWorkspaceProvider so the guard no-ops).
Run: `pnpm exec tsc --noEmit` → clean. Then `pnpm --filter @maestro/core build`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestrator.ts packages/core/test/orchestrator.diff.test.ts
git commit -m "feat(core): compute diff on done via feature-detected WorkspaceManager"
```

---

### Task A4: `merge` / `discard` / conflict transitions

**Files:** Modify `packages/core/src/orchestrator.ts`; Create `packages/core/test/orchestrator.merge.test.ts`.

- [ ] **Step 1: Failing test**

Create `packages/core/test/orchestrator.merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeEngineAdapter, FakeWorkspaceManager, Orchestrator } from "../src/index.js";
import type { Role } from "../src/index.js";

const role: Role = { name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" };

function build(script: { manager?: FakeWorkspaceManager } = {}) {
  const manager = script.manager ?? new FakeWorkspaceManager();
  const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
  orch.registerRole(role);
  orch.registerAdapter(
    new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }),
  );
  return { orch, manager };
}

function waitFor(orch: Orchestrator, agentId: string, state: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => { if (orch.getAgent(agentId)?.state === state) resolve(); };
    orch.on(check);
    check();
  });
}

describe("Orchestrator merge/discard", () => {
  it("clean merge -> merged + cleanup", async () => {
    const { orch, manager } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");

    const result = await orch.merge(agent.id);
    expect(result).toEqual({ status: "clean" });
    expect(orch.getAgent(agent.id)!.state).toBe("merged");
    expect(manager.merged).toContain(agent.id);
    expect(manager.cleaned).toContain(agent.id);
  });

  it("conflict merge -> conflict state, no cleanup, files recorded", async () => {
    const manager = new FakeWorkspaceManager();
    const { orch } = build({ manager });
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    manager.setMergeResult(agent.id, { status: "conflict", files: ["x.ts"] });

    const result = await orch.merge(agent.id);
    expect(result).toEqual({ status: "conflict", files: ["x.ts"] });
    expect(orch.getAgent(agent.id)!.state).toBe("conflict");
    expect(orch.getAgent(agent.id)!.conflict).toEqual({ files: ["x.ts"] });
    expect(manager.cleaned).not.toContain(agent.id); // preserved for resolution
  });

  it("merge throws unless the agent is done", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.merge(agent.id); // -> merged
    await expect(orch.merge(agent.id)).rejects.toThrow("not ready to merge");
  });

  it("discard -> discarded + cleanup, allowed from done/conflict", async () => {
    const { orch, manager } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");

    await orch.discard(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("discarded");
    expect(manager.discarded).toContain(agent.id);
  });

  it("merge throws when the provider is not a WorkspaceManager", async () => {
    const { Orchestrator, FakeWorkspaceProvider, FakeEngineAdapter } = await import("../src/index.js");
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await expect(orch.merge(agent.id)).rejects.toThrow("does not support merge");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && pnpm vitest run test/orchestrator.merge.test.ts` → FAIL (merge/discard missing).

- [ ] **Step 3: Implement merge/discard**

In `packages/core/src/orchestrator.ts`, add the type import for `MergeResult` (to the `./types.js` import) and add these public/private methods to the class:

```ts
  async merge(agentId: string): Promise<MergeResult> {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "done") {
      throw new Error(`Agent ${agentId} is not ready to merge (state: ${agent.state})`);
    }
    const ws = this.workspaces;
    if (!isWorkspaceManager(ws)) {
      throw new Error("Workspace provider does not support merge");
    }
    const result = await ws.merge(agentId);
    if (result.status === "conflict") {
      agent.conflict = { files: result.files };
      this.update(agent, "conflict"); // worktree preserved, no cleanup
      return result;
    }
    await ws.cleanup(agentId);
    this.update(agent, "merged");
    return result;
  }

  async discard(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (!this.canDiscard(agent.state)) {
      throw new Error(`Agent ${agentId} cannot be discarded (state: ${agent.state})`);
    }
    const ws = this.workspaces;
    if (isWorkspaceManager(ws)) {
      await ws.discard(agentId);
    } else {
      await ws.cleanup(agentId);
    }
    this.update(agent, "discarded");
  }

  private canDiscard(state: AgentState): boolean {
    return state === "done" || state === "error" || state === "stopped" || state === "conflict";
  }
```

(`requireAgent`, `update`, `AgentState`, `isWorkspaceManager` are already in scope; add `MergeResult` to the `./types.js` type import.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/core && pnpm vitest run test/orchestrator.merge.test.ts` → PASS (5).
Run: `cd packages/core && pnpm vitest run && pnpm exec tsc --noEmit` → ALL pass (now ~46 core tests), clean.
Run: `pnpm --filter @maestro/core build`.
Run: confirm adapter unaffected: `cd packages/adapter-copilot && pnpm vitest run` → 20 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestrator.ts packages/core/test/orchestrator.merge.test.ts
git commit -m "feat(core): add orchestrator merge/discard with conflict state and resolution-time cleanup"
```

---

# Phase B — Real git WorkspaceManager (`@maestro/workspace`)

A new package implementing `WorkspaceManager` against real git, plugged into the Phase-A seam.

### Task B0: Scaffold `@maestro/workspace`

**Files:** Create `packages/workspace/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts}`.

- [ ] **Step 1: package.json**

Create `packages/workspace/package.json`:

```json
{
  "name": "@maestro/workspace",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json"
  },
  "dependencies": { "@maestro/core": "workspace:*" },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: tsconfigs + vitest config**

Create `packages/workspace/tsconfig.json` (same as adapter-copilot's), `packages/workspace/tsconfig.build.json` (extends, `rootDir: "src"`, `include: ["src"]`), and `packages/workspace/vitest.config.ts` (same as adapter-copilot's). Use those files verbatim from `packages/adapter-copilot/`.

- [ ] **Step 3: Placeholder index + install + build core**

Create `packages/workspace/src/index.ts`: `export const MAESTRO_WORKSPACE_VERSION = "0.0.0";`
Run: `pnpm install` then `pnpm --filter @maestro/core build`.
Run: `cd packages/workspace && pnpm vitest run` (no tests ok) and `pnpm exec tsc --noEmit` (clean).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(workspace): scaffold @maestro/workspace package"
```

---

### Task B1: `GitRunner` + `nodeGitRunner` + fake

**Files:** Create `packages/workspace/src/git-runner.ts`, `packages/workspace/test/fake-git-runner.ts`; Test `packages/workspace/test/git-runner.test.ts`.

- [ ] **Step 1: Implement git-runner.ts**

Create `packages/workspace/src/git-runner.ts`:

```ts
import { spawn } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs a git command. Injected so logic is testable without real git. */
export type GitRunner = (args: readonly string[], opts?: { cwd?: string }) => Promise<GitResult>;

/** Default GitRunner backed by node:child_process. */
export const nodeGitRunner: GitRunner = (args, opts) =>
  new Promise<GitResult>((resolve, reject) => {
    const child = spawn("git", [...args], { cwd: opts?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: code ?? 1,
      }),
    );
  });
```

- [ ] **Step 2: Shared fake**

Create `packages/workspace/test/fake-git-runner.ts`:

```ts
import type { GitResult, GitRunner } from "../src/git-runner.js";

export interface FakeGitCall {
  args: readonly string[];
  cwd?: string;
}

/**
 * Fake GitRunner. `responses` maps a key (the joined args, or a prefix you
 * register) to a scripted result. Records every call for assertions.
 */
export function makeFakeGitRunner(
  responses: Array<{ match: (args: readonly string[]) => boolean; result: Partial<GitResult> }> = [],
): { runner: GitRunner; calls: FakeGitCall[] } {
  const calls: FakeGitCall[] = [];
  const runner: GitRunner = (args, opts) => {
    calls.push({ args, cwd: opts?.cwd });
    const hit = responses.find((r) => r.match(args));
    return Promise.resolve({
      stdout: hit?.result.stdout ?? "",
      stderr: hit?.result.stderr ?? "",
      exitCode: hit?.result.exitCode ?? 0,
    });
  };
  return { runner, calls };
}

/** Match helper: args start with this prefix. */
export const startsWith =
  (...prefix: string[]) =>
  (args: readonly string[]): boolean =>
    prefix.every((p, i) => args[i] === p);
```

- [ ] **Step 3: Test the fake records + nodeGitRunner runs**

Create `packages/workspace/test/git-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nodeGitRunner } from "../src/git-runner.js";
import { makeFakeGitRunner, startsWith } from "./fake-git-runner.js";

describe("makeFakeGitRunner", () => {
  it("records calls and returns scripted results", async () => {
    const { runner, calls } = makeFakeGitRunner([
      { match: startsWith("rev-parse"), result: { stdout: "abc\n" } },
    ]);
    const r = await runner(["rev-parse", "HEAD"], { cwd: "/repo" });
    expect(r.stdout).toBe("abc\n");
    expect(calls[0]).toEqual({ args: ["rev-parse", "HEAD"], cwd: "/repo" });
  });
});

describe("nodeGitRunner", () => {
  it("runs real git --version (exit 0)", async () => {
    const r = await nodeGitRunner(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("git version");
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `cd packages/workspace && pnpm vitest run test/git-runner.test.ts` → PASS (2). `pnpm exec tsc --noEmit` → clean.

```bash
git add packages/workspace/src/git-runner.ts packages/workspace/test/fake-git-runner.ts packages/workspace/test/git-runner.test.ts
git commit -m "feat(workspace): add GitRunner abstraction, nodeGitRunner, and fake"
```

---

### Task B2: `GitWorkspaceManager` — create / cleanup / discard (unit)

**Files:** Create `packages/workspace/src/git-workspace-manager.ts`; Test `packages/workspace/test/git-workspace-manager.unit.test.ts`.

- [ ] **Step 1: Failing unit test (create/cleanup/discard arg arrays)**

Create `packages/workspace/test/git-workspace-manager.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GitWorkspaceManager } from "../src/git-workspace-manager.js";
import { makeFakeGitRunner, startsWith } from "./fake-git-runner.js";

const REPO = "/repo";

function mgr(responses: Parameters<typeof makeFakeGitRunner>[0] = []) {
  const fake = makeFakeGitRunner([
    { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
    ...responses,
  ]);
  return { manager: new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner }), calls: fake.calls };
}

describe("GitWorkspaceManager create/cleanup/discard", () => {
  it("create: prunes, captures base, adds worktree, returns Workspace", async () => {
    const { manager, calls } = mgr();
    const ws = await manager.create("agent-1");
    expect(ws).toEqual({
      agentId: "agent-1",
      path: "/repo/.conductor/wt/agent-1",
      branch: "agent/agent-1",
    });
    // captured base then added worktree off it
    expect(calls.some((c) => c.args.join(" ") === "rev-parse HEAD")).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.args[0] === "worktree" &&
          c.args[1] === "add" &&
          c.args.includes("-b") &&
          c.args.includes("agent/agent-1") &&
          c.args.includes("base123"),
      ),
    ).toBe(true);
  });

  it("cleanup: removes the worktree (force) and prunes", async () => {
    const { manager, calls } = mgr();
    await manager.create("agent-1");
    await manager.cleanup("agent-1");
    expect(
      calls.some((c) => c.args.join(" ").startsWith("worktree remove --force /repo/.conductor/wt/agent-1")),
    ).toBe(true);
  });

  it("discard: removes worktree and force-deletes the branch", async () => {
    const { manager, calls } = mgr();
    await manager.create("agent-1");
    await manager.discard("agent-1");
    expect(calls.some((c) => c.args.join(" ") === "branch -D agent/agent-1")).toBe(true);
  });

  it("create throws if the worktree was never created when diffing", async () => {
    const { manager } = mgr();
    await expect(manager.diff("missing")).rejects.toThrow("Unknown agent");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/workspace && pnpm vitest run test/git-workspace-manager.unit.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement git-workspace-manager.ts (create/cleanup/discard + record-keeping)**

Create `packages/workspace/src/git-workspace-manager.ts`:

```ts
import * as path from "node:path";
import type { Diff, MergeResult, Workspace } from "@maestro/core";
import type { WorkspaceManager } from "@maestro/core";
import { nodeGitRunner } from "./git-runner.js";
import type { GitRunner } from "./git-runner.js";

interface Record {
  path: string;
  branch: string;
  baseSha: string;
}

export interface GitWorkspaceManagerOptions {
  repoRoot: string;
  runner?: GitRunner;
}

export class GitWorkspaceManager implements WorkspaceManager {
  private readonly runner: GitRunner;
  private readonly repoRoot: string;
  private readonly records = new Map<string, Record>();

  constructor(opts: GitWorkspaceManagerOptions) {
    this.repoRoot = opts.repoRoot;
    this.runner = opts.runner ?? nodeGitRunner;
  }

  static slug(agentId: string): string {
    return agentId.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  }

  private require(agentId: string): Record {
    const r = this.records.get(agentId);
    if (!r) throw new Error(`Unknown agent: ${agentId}`);
    return r;
  }

  private async git(args: string[], cwd = this.repoRoot): Promise<string> {
    const r = await this.runner(args, { cwd });
    if (r.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed (${r.exitCode}): ${r.stderr.trim()}`);
    }
    return r.stdout;
  }

  async create(agentId: string): Promise<Workspace> {
    const wtPath = path.join(this.repoRoot, ".conductor", "wt", agentId);
    const branch = `agent/${GitWorkspaceManager.slug(agentId)}`;
    const baseSha = (await this.git(["rev-parse", "HEAD"])).trim();
    await this.runner(["worktree", "prune"], { cwd: this.repoRoot });
    await this.git(["worktree", "add", wtPath, "-b", branch, baseSha]);
    this.records.set(agentId, { path: wtPath, branch, baseSha });
    return { agentId, path: wtPath, branch };
  }

  async diff(agentId: string): Promise<Diff> {
    const rec = this.require(agentId);
    // Snapshot any uncommitted agent work so the diff captures it.
    const status = await this.git(["status", "--porcelain"], rec.path);
    if (status.trim().length > 0) {
      await this.git(["add", "-A"], rec.path);
      await this.git(["commit", "-m", "maestro: agent work snapshot"], rec.path);
    }
    const files = (await this.git(["diff", "--name-only", rec.baseSha, "HEAD"], rec.path))
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
    const patch = await this.git(["diff", rec.baseSha, "HEAD"], rec.path);
    return { files, patch };
  }

  async merge(agentId: string): Promise<MergeResult> {
    const rec = this.require(agentId);
    const attempt = await this.runner(["merge", "--no-commit", "--no-ff", rec.branch], { cwd: this.repoRoot });
    if (attempt.exitCode !== 0) {
      const conflicted = (await this.git(["diff", "--name-only", "--diff-filter=U"]))
        .split("\n").map((f) => f.trim()).filter(Boolean);
      await this.runner(["merge", "--abort"], { cwd: this.repoRoot });
      return { status: "conflict", files: conflicted };
    }
    await this.git(["commit", "--no-edit", "-m", `Merge ${rec.branch} via Maestro`]);
    return { status: "clean" };
  }

  async discard(agentId: string): Promise<void> {
    await this.teardown(agentId, true);
  }

  async cleanup(agentId: string): Promise<void> {
    await this.teardown(agentId, true);
  }

  private async teardown(agentId: string, deleteBranch: boolean): Promise<void> {
    const rec = this.records.get(agentId);
    if (!rec) return;
    await this.runner(["worktree", "remove", "--force", rec.path], { cwd: this.repoRoot });
    if (deleteBranch) {
      await this.runner(["branch", "-D", rec.branch], { cwd: this.repoRoot });
    }
    await this.runner(["worktree", "prune"], { cwd: this.repoRoot });
    this.records.delete(agentId);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/workspace && pnpm vitest run test/git-workspace-manager.unit.test.ts` → PASS (4). `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace/src/git-workspace-manager.ts packages/workspace/test/git-workspace-manager.unit.test.ts
git commit -m "feat(workspace): GitWorkspaceManager create/cleanup/discard/diff/merge (unit-tested)"
```

---

### Task B3: diff + merge unit coverage (fake runner)

**Files:** Test `packages/workspace/test/git-workspace-manager.unit.test.ts` (extend).

- [ ] **Step 1: Add diff + merge unit tests**

Append to `packages/workspace/test/git-workspace-manager.unit.test.ts` inside the describe:

```ts
  it("diff: snapshots dirty work, then three-arg base..HEAD diff", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("status", "--porcelain"), result: { stdout: " M a.ts\n" } },
      { match: startsWith("diff", "--name-only"), result: { stdout: "a.ts\n" } },
      { match: (a) => a[0] === "diff" && a[1] === "base123" && a[2] === "HEAD", result: { stdout: "PATCH" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    const diff = await m.diff("a1");
    expect(diff).toEqual({ files: ["a.ts"], patch: "PATCH" });
    // dirty -> add -A + commit happened before the diff
    expect(fake.calls.some((c) => c.args.join(" ") === "add -A")).toBe(true);
    expect(fake.calls.some((c) => c.args[0] === "commit")).toBe(true);
  });

  it("merge clean: --no-commit --no-ff then commit", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("merge", "--no-commit"), result: { exitCode: 0 } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    expect(await m.merge("a1")).toEqual({ status: "clean" });
    expect(fake.calls.some((c) => c.args[0] === "commit" && c.args.includes("--no-edit"))).toBe(true);
  });

  it("merge conflict: collects U files and aborts", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("merge", "--no-commit"), result: { exitCode: 1, stdout: "CONFLICT" } },
      { match: startsWith("diff", "--name-only", "--diff-filter=U"), result: { stdout: "a.ts\n" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    expect(await m.merge("a1")).toEqual({ status: "conflict", files: ["a.ts"] });
    expect(fake.calls.some((c) => c.args.join(" ") === "merge --abort")).toBe(true);
  });
```

- [ ] **Step 2: Run + commit**

Run: `cd packages/workspace && pnpm vitest run test/git-workspace-manager.unit.test.ts` → PASS (7). `pnpm exec tsc --noEmit` → clean.

```bash
git add packages/workspace/test/git-workspace-manager.unit.test.ts
git commit -m "test(workspace): unit-cover diff snapshot and merge clean/conflict paths"
```

---

### Task B4: Real-git integration tests

**Files:** Test `packages/workspace/test/git-workspace-manager.integration.test.ts`.

- [ ] **Step 1: Integration tests against throwaway repos**

Create `packages/workspace/test/git-workspace-manager.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceManager } from "../src/git-workspace-manager.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "maestro-ws-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@t.com");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "file.txt"), "line1\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("GitWorkspaceManager (real git)", () => {
  it("create makes an isolated worktree + branch; cleanup removes it", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    expect(existsSync(ws.path)).toBe(true);
    expect(git(repo, "branch", "--list", "agent/a1")).toContain("agent/a1");
    await m.cleanup("a1");
    expect(existsSync(ws.path)).toBe(false);
  });

  it("diff captures the agent's edits (committed or not)", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    writeFileSync(join(ws.path, "new.txt"), "hello\n"); // uncommitted in the worktree
    const diff = await m.diff("a1");
    expect(diff.files).toContain("new.txt");
    expect(diff.patch).toContain("hello");
  });

  it("clean merge applies the agent's work to the base branch", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    writeFileSync(join(ws.path, "added.txt"), "x\n");
    await m.diff("a1"); // snapshots the commit
    const result = await m.merge("a1");
    expect(result).toEqual({ status: "clean" });
    expect(existsSync(join(repo, "added.txt"))).toBe(true);
  });

  it("conflict merge reports the conflicted file and leaves the repo clean", async () => {
    // base advances on the same line the agent also edits -> conflict
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    writeFileSync(join(ws.path, "file.txt"), "agent-change\n");
    await m.diff("a1");
    // advance base on the same line
    writeFileSync(join(repo, "file.txt"), "base-change\n");
    git(repo, "commit", "-q", "-am", "base edit");
    const result = await m.merge("a1");
    expect(result.status).toBe("conflict");
    if (result.status === "conflict") expect(result.files).toContain("file.txt");
    // repo is clean after abort (no merge in progress)
    expect(git(repo, "status", "--porcelain").trim()).toBe("");
  });

  it("discard removes the worktree and the branch", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    await m.discard("a1");
    expect(existsSync(ws.path)).toBe(false);
    expect(git(repo, "branch", "--list", "agent/a1").trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `cd packages/workspace && pnpm vitest run test/git-workspace-manager.integration.test.ts` → PASS (5). (Requires real `git`.)

```bash
git add packages/workspace/test/git-workspace-manager.integration.test.ts
git commit -m "test(workspace): real-git integration tests (worktree, diff, merge, conflict, discard)"
```

---

### Task B5: End-to-end through the Orchestrator + public API + gate

**Files:** Modify `packages/workspace/src/index.ts`; Test `packages/workspace/test/orchestrator-e2e.integration.test.ts`.

- [ ] **Step 1: Public exports**

Replace `packages/workspace/src/index.ts`:

```ts
export const MAESTRO_WORKSPACE_VERSION = "0.0.0";
export { GitWorkspaceManager } from "./git-workspace-manager.js";
export type { GitWorkspaceManagerOptions } from "./git-workspace-manager.js";
export { nodeGitRunner } from "./git-runner.js";
export type { GitRunner, GitResult } from "./git-runner.js";
```

- [ ] **Step 2: E2E integration test (real worktree, fake adapter, real Orchestrator)**

Create `packages/workspace/test/orchestrator-e2e.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEngineAdapter, Orchestrator } from "@maestro/core";
import type { EngineAdapter, AgentSession, Task, Workspace, Role } from "@maestro/core";
import { GitWorkspaceManager } from "../src/index.js";

// An adapter that writes a file into the agent's real worktree, then emits done.
class WritingAdapter implements EngineAdapter {
  readonly id = "writer";
  readonly capabilities = { streaming: true, structuredEvents: false, approvals: false, steerable: false };
  health() { return Promise.resolve({ ok: true }); }
  start(_task: Task, workspace: Workspace): AgentSession {
    writeFileSync(join(workspace.path, "agent.txt"), "agent was here\n");
    async function* events() {
      yield { kind: "output", text: "wrote a file" } as const;
      yield { kind: "done", summary: "done" } as const;
    }
    return { events: events(), send() {}, respond() {}, stop() {} };
  }
}

const role: Role = { name: "Writer", instructions: "", engine: { id: "writer" }, autonomy: "yolo" };
function waitFor(o: Orchestrator, id: string, pred: () => boolean) {
  return new Promise<void>((res) => { const c = () => pred() && res(); o.on(c); c(); });
}

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "maestro-e2e-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo });
  g("init", "-q"); g("config", "user.email", "t@t.com"); g("config", "user.name", "T");
  writeFileSync(join(repo, "seed.txt"), "seed\n"); g("add", "."); g("commit", "-q", "-m", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("Orchestrator + GitWorkspaceManager e2e", () => {
  it("runs an agent in a real worktree, computes the diff, merges it in", async () => {
    const manager = new GitWorkspaceManager({ repoRoot: repo });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new WritingAdapter());

    const agent = orch.spawn("Writer", "write a file");
    await waitFor(orch, agent.id, () => orch.getAgent(agent.id)?.diff !== undefined);

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.diff!.files).toContain("agent.txt");

    const result = await orch.merge(agent.id);
    expect(result).toEqual({ status: "clean" });
    expect(orch.getAgent(agent.id)!.state).toBe("merged");
    expect(existsSync(join(repo, "agent.txt"))).toBe(true);
  });
});
```

(`FakeEngineAdapter` import is unused above — remove it; kept here only to show it's available. Use only what you import.)

- [ ] **Step 3: Full gate**

Run: `cd packages/workspace && pnpm vitest run && pnpm exec tsc --noEmit` → all pass (git-runner 2, unit 7, integration 5, e2e 1 = 15), clean.
Run: confirm core + adapter unchanged: `cd ../core && pnpm vitest run` (≈46), `cd ../adapter-copilot && pnpm vitest run` (20).
Run: `pnpm --filter @maestro/workspace build` → `dist/index.js` exists.

- [ ] **Step 4: Commit**

```bash
git add packages/workspace/src/index.ts packages/workspace/test/orchestrator-e2e.integration.test.ts
git commit -m "feat(workspace): public API + e2e (real worktree through the Orchestrator); pass M3 gate"
```

---

## Definition of done (Milestone 3)

- Phase A: `@maestro/core` gains the `WorkspaceManager` capability, diff-on-done, and `merge`/`discard`/`conflict`, with all 55 prior tests still green (additive, feature-detected).
- Phase B: `@maestro/workspace` provides `GitWorkspaceManager` (real worktree per agent, diff, clean+conflict merge, discard), unit-tested with a fake runner and integration-tested against real git.
- End-to-end: an agent runs in a real isolated worktree, the orchestrator computes its diff, and `merge` lands the work (or reports a conflict). The "review the diff, merge or discard" product is real.

## Deferred (tracked follow-ups, NOT in M3)

- **Rebase / stale-base drift** (`isStale` + `rebaseAgent`): detect when the base advanced and offer a one-click rebase before merge.
- **Send-conflict-back-to-agent:** plant conflict markers in the worktree and re-engage the agent to resolve.
- **Serialized-merge mutex:** only needed once concurrent merges are possible from the UI.
- **PR/remote merge strategy:** merge by opening a PR/branch instead of merging into the local working branch.
- **Branch-retention policy / submodules / LFS** edge cases.

## What this unlocks

- **Milestone 4:** the VS Code extension shell + webview cockpit — roster, live output panes, the **diff review** surface (now real), and Merge/Discard/Conflict actions wired to `orch.merge`/`orch.discard`, rendering `OrchestratorEvent`s.

## Self-review notes

- **Backward compatibility is the spine:** every core change is additive (new optional fields, a new non-terminal state with no exhaustive switch to break, a feature-detected capability). diff-on-done is doubly guarded; `cleanup` is wired to resolution only. The plan verifies the 55 existing tests stay green at each Phase-A step.
- **Type consistency:** `GitRunner` (function injection, like `SpawnFn`), `MergeResult` (`status` discriminant), and `WorkspaceManager` are defined once and reused; `GitWorkspaceManager` implements the core `WorkspaceManager` interface verbatim.
- **No placeholders:** every step has complete, runnable code and exact commands; the one noted unused import in B5 Step 2 is called out to remove before running.

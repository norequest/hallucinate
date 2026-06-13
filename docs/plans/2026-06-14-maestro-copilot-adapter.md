# Maestro GitHub Copilot Adapter Implementation Plan (Milestone 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@maestro/adapter-copilot`, the first (and, for the current product focus, only) real engine adapter. It spawns the GitHub Copilot CLI (`copilot -p`) as a background subprocess in an isolated worktree, streams its plain-text output as `AgentEvent`s, and reports completion on process exit, satisfying the `EngineAdapter` contract proven in Milestone 1. Validated entirely offline with a fake spawn, and verified end-to-end through the real `Orchestrator`.

**Architecture:** A new package `@maestro/adapter-copilot` depending only on `@maestro/core` (no external SDK). The adapter builds a `copilot` argv from a `Role`, spawns it via an injected `spawn` (default: `node:child_process.spawn`) with `cwd` = the worktree, streams `stdout` chunks as `output` events, and on `close` emits `done` (exit 0) or `error` (non-zero). Plain-text v1: no structured per-tool events, no interactive approval — the agent runs `--allow-all` sandboxed in its worktree and the conductor reviews the **diff** (computed by the Workspace Manager, M3). `spawn` is injected so 100% of the logic is testable offline (no `copilot` process, no network, no token).

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, pnpm workspace, `node:child_process`. Reuses `@maestro/core` (`EventQueue`, contract types, `Orchestrator`, `FakeWorkspaceProvider`).

---

## Why Copilot, and why plain-text v1

Product focus is **GitHub Copilot only** (decided 2026-06-14). Rationale: it is the cleanest subscription reuse of every engine researched (`copilot` authenticates with the user's Copilot subscription via a GitHub token, no API key — unlike the Claude Agent SDK, which requires `ANTHROPIC_API_KEY` and forbids subscription reuse). `--model` still selects Claude/GPT/Gemini *through* Copilot, so a single subscription yields a multi-model team. M1's orchestration core is engine-agnostic, so this is the first adapter, not a re-architecture.

The pure Conductor flow — spawn parallel agents in isolated worktrees, watch them, review the diff, merge — does **not** require interactive per-tool approval. Each agent runs `--allow-all` inside its own git worktree (sandboxed), and the conductor reviews the resulting diff before merging. So v1 drops the approval-interception complexity entirely.

## Verified Copilot CLI facts (2026-06-14, docs.github.com/copilot + changelog)

- **Binary:** `npm install -g @github/copilot` → `copilot`. GA since 2026-02-25 (fast-moving; v1.0.62 on 2026-06-13). Node 22+.
- **Headless one-shot:** `copilot -p "<task>"` runs the prompt and **exits**. `-s`/`--silent` suppresses the stats footer. `--no-ask-user` disables clarifying questions.
- **Working dir:** `-C <dir>` (v1.0.42+) "Change working directory before starting." Also respects the process `cwd`. We pass both (`-C` arg + spawn `cwd`).
- **Unattended permissions:** `--allow-all` (= `--allow-all-tools --allow-all-paths --allow-all-urls`; alias `--yolo`). `--no-ask-user` to never block. (Enforcement formalized in v1.0.52+.)
- **Model:** `--model <name>` (e.g. `claude-sonnet-4.6`, `gpt-5`, `gemini-3-pro`, `auto`). Subscription-entitlement dependent.
- **Output:** `-p` streams plain text to stdout (streaming on by default). UI chrome (Braille spinner glyphs, `●`/`│`/`└` tool annotations) is mixed into stdout in text mode; we strip the animated Braille glyphs and keep the rest. A `--output-format json` (JSONL) mode exists but its **event schema is undocumented** — deferred to a future structured upgrade.
- **Done detection:** the process exits. Watch Node `close`: exit `0` = success, non-zero = failure. (Only `0`/`1` are documented.)
- **Auth:** `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (a GitHub token with Copilot access). No API key. Health: `copilot --version` for install; token presence for auth.

## Key decisions

- **Inject `spawn` for testability.** `CopilotAdapter` takes an optional `spawn` (defaults to `node:child_process.spawn`). Tests pass a fake child that emits scripted `stdout` and a `close` code; no `copilot` process, no network, no token in the unit suite.
- **Capabilities (honest degradation):** `{ streaming: true, structuredEvents: false, approvals: false, steerable: false }`. The M1 orchestrator already degrades for `approvals: false` (no inline approve/deny UI) and `structuredEvents: false`.
- **`done.diff` omitted.** Plain text gives no diff; the Workspace Manager (M3) computes the real diff from the worktree. M1 made `diff` optional on `done`.
- **Autonomy in v1:** all autonomy levels run `--allow-all --no-ask-user` (safe in an isolated worktree). Fine-grained / interactive approval is an ACP-mode upgrade, deferred. Documented in the README.

## File Structure

```
maestro-vscode/
  packages/
    adapter-copilot/
      package.json                 # @maestro/adapter-copilot
      tsconfig.json
      vitest.config.ts
      src/
        types.ts                   # ChildHandle + SpawnFn (narrow spawn interface)
        capabilities.ts            # COPILOT_CAPABILITIES
        auth.ts                    # resolveAuth(env) -> HealthStatus
        args.ts                    # buildArgs(task, workspace, role) + cleanOutput(text)
        copilot-session.ts         # CopilotSession implements AgentSession
        adapter.ts                 # CopilotAdapter implements EngineAdapter
        index.ts                   # public exports
      scripts/
        smoke.mts                  # OPTIONAL manual live test (real copilot, gated)
      test/
        capabilities.test.ts
        auth.test.ts
        args.test.ts
        fake-spawn.ts              # shared fake child + spawn
        copilot-session.test.ts
        adapter.test.ts
        conformance.test.ts        # drives the real Orchestrator
        index.test.ts
```

---

### Task 0: Scaffold `@maestro/adapter-copilot` and build core

**Files:** Create `packages/adapter-copilot/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`

- [ ] **Step 1: package.json**

Create `packages/adapter-copilot/package.json`:

```json
{
  "name": "@maestro/adapter-copilot",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "smoke": "node --experimental-strip-types scripts/smoke.mts"
  },
  "dependencies": {
    "@maestro/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

Create `packages/adapter-copilot/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: vitest.config.ts**

Create `packages/adapter-copilot/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Placeholder index**

Create `packages/adapter-copilot/src/index.ts`:

```ts
export const MAESTRO_ADAPTER_COPILOT_VERSION = "0.0.0";
```

- [ ] **Step 5: Install and build core**

Run: `pnpm install`
Then: `pnpm --filter @maestro/core build`
Expected: workspace links `@maestro/core` into the new package; core `dist/` exists. (Re-run the build if core's types change later.)

- [ ] **Step 6: Verify toolchain**

Run: `cd packages/adapter-copilot && pnpm vitest run` → "No test files found" (acceptable).
Run: `cd packages/adapter-copilot && pnpm exec tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(adapter-copilot): scaffold @maestro/adapter-copilot package"
```

---

### Task 1: Capabilities and auth

**Files:** Create `src/capabilities.ts`, `src/auth.ts`; Test `test/capabilities.test.ts`, `test/auth.test.ts`

- [ ] **Step 1: Failing capabilities test**

Create `packages/adapter-copilot/test/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COPILOT_CAPABILITIES } from "../src/capabilities.js";

describe("COPILOT_CAPABILITIES", () => {
  it("reports streaming only (no structured events, approvals, or steering in v1)", () => {
    expect(COPILOT_CAPABILITIES).toEqual({
      streaming: true,
      structuredEvents: false,
      approvals: false,
      steerable: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/adapter-copilot && pnpm vitest run test/capabilities.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement capabilities.ts**

Create `packages/adapter-copilot/src/capabilities.ts`:

```ts
import type { Capabilities } from "@maestro/core";

export const COPILOT_CAPABILITIES: Capabilities = {
  streaming: true,
  structuredEvents: false,
  approvals: false,
  steerable: false,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/adapter-copilot && pnpm vitest run test/capabilities.test.ts` → PASS (1).

- [ ] **Step 5: Failing auth test**

Create `packages/adapter-copilot/test/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAuth } from "../src/auth.js";

describe("resolveAuth", () => {
  it("is ok when COPILOT_GITHUB_TOKEN is set", () => {
    expect(resolveAuth({ COPILOT_GITHUB_TOKEN: "ghp_x" })).toEqual({ ok: true });
  });

  it("is ok when GH_TOKEN or GITHUB_TOKEN is set", () => {
    expect(resolveAuth({ GH_TOKEN: "x" }).ok).toBe(true);
    expect(resolveAuth({ GITHUB_TOKEN: "x" }).ok).toBe(true);
  });

  it("is not ok with no token and points at gh auth", () => {
    const status = resolveAuth({});
    expect(status.ok).toBe(false);
    expect(status.detail).toContain("gh auth login");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd packages/adapter-copilot && pnpm vitest run test/auth.test.ts` → FAIL (module missing).

- [ ] **Step 7: Implement auth.ts**

Create `packages/adapter-copilot/src/auth.ts`:

```ts
import type { HealthStatus } from "@maestro/core";

const TOKEN_VARS = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;

/** Check for a GitHub token granting Copilot access. The Copilot CLI reuses the
 *  user's Copilot subscription via this token — no separate API key. */
export function resolveAuth(env: Record<string, string | undefined>): HealthStatus {
  if (TOKEN_VARS.some((v) => env[v])) return { ok: true };
  return {
    ok: false,
    detail:
      "No GitHub token found. Set COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN) " +
      "with Copilot access, or run `gh auth login`.",
  };
}
```

- [ ] **Step 8: Run, typecheck, commit**

Run: `cd packages/adapter-copilot && pnpm vitest run test/auth.test.ts` → PASS (3).
Run: `cd packages/adapter-copilot && pnpm exec tsc --noEmit` → clean.

```bash
git add packages/adapter-copilot/src/capabilities.ts packages/adapter-copilot/src/auth.ts packages/adapter-copilot/test/capabilities.test.ts packages/adapter-copilot/test/auth.test.ts
git commit -m "feat(adapter-copilot): add capabilities and GitHub-token auth check"
```

---

### Task 2: `buildArgs` and `cleanOutput`

**Files:** Create `src/args.ts`; Test `test/args.test.ts`

- [ ] **Step 1: Failing test**

Create `packages/adapter-copilot/test/args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildArgs, cleanOutput } from "../src/args.js";
import type { Role, Task, Workspace } from "@maestro/core";

const task: Task = { id: "t1", description: "add caching", roleName: "Implementer" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/wt/a1", branch: "agent/a1" };
const role = (model?: string): Role => ({
  name: "Implementer",
  instructions: "x",
  engine: { id: "copilot", model },
  autonomy: "yolo",
});

describe("buildArgs", () => {
  it("builds an unattended, worktree-scoped argv", () => {
    expect(buildArgs(task, workspace, role())).toEqual([
      "-C",
      "/tmp/wt/a1",
      "-p",
      "add caching",
      "-s",
      "--no-ask-user",
      "--allow-all",
    ]);
  });

  it("appends --model when the role specifies one", () => {
    expect(buildArgs(task, workspace, role("claude-sonnet-4.6"))).toEqual([
      "-C",
      "/tmp/wt/a1",
      "-p",
      "add caching",
      "-s",
      "--no-ask-user",
      "--allow-all",
      "--model",
      "claude-sonnet-4.6",
    ]);
  });
});

describe("cleanOutput", () => {
  it("strips Braille spinner glyphs but keeps real text and tool annotations", () => {
    expect(cleanOutput("⠇⠋ running tests")).toBe(" running tests");
    expect(cleanOutput("● shell: npm test")).toBe("● shell: npm test");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/adapter-copilot && pnpm vitest run test/args.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement args.ts**

Create `packages/adapter-copilot/src/args.ts`:

```ts
import type { Role, Task, Workspace } from "@maestro/core";

/**
 * Build the `copilot` argv for an unattended, worktree-scoped run.
 * v1 always uses `--allow-all` (safe because each agent is isolated in its own
 * worktree) and `--no-ask-user`. Fine-grained per-tool approval is a later
 * ACP-mode upgrade.
 */
export function buildArgs(task: Task, workspace: Workspace, role: Role): string[] {
  const args = ["-C", workspace.path, "-p", task.description, "-s", "--no-ask-user", "--allow-all"];
  if (role.engine.model) {
    args.push("--model", role.engine.model);
  }
  return args;
}

const SPINNER = /[⠀-⣿]/g; // animated Braille spinner glyphs

/** Remove animated spinner glyphs from a streamed stdout chunk; keep the rest. */
export function cleanOutput(text: string): string {
  return text.replace(SPINNER, "");
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `cd packages/adapter-copilot && pnpm vitest run test/args.test.ts` → PASS (3).
Run: `cd packages/adapter-copilot && pnpm exec tsc --noEmit` → clean.

```bash
git add packages/adapter-copilot/src/args.ts packages/adapter-copilot/test/args.test.ts
git commit -m "feat(adapter-copilot): build copilot argv and clean streamed output"
```

---

### Task 3: `ChildHandle`/`SpawnFn` and `CopilotSession`

**Files:** Create `src/types.ts`, `src/copilot-session.ts`; Test `test/fake-spawn.ts`, `test/copilot-session.test.ts`

- [ ] **Step 1: Define the narrow spawn interface**

Create `packages/adapter-copilot/src/types.ts`:

```ts
/** A readable stream we only ever attach a "data" listener to. */
export interface DataStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
}

/** Minimal handle over a spawned child process. Node's ChildProcess satisfies this. */
export interface ChildHandle {
  readonly stdout: DataStream;
  readonly stderr: DataStream;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

/** The shape of `node:child_process.spawn`, narrowed for injection and faking. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => ChildHandle;
```

- [ ] **Step 2: Create the shared fake spawn**

Create `packages/adapter-copilot/test/fake-spawn.ts`:

```ts
import type { ChildHandle, DataStream, SpawnFn } from "../src/types.js";

class FakeStream implements DataStream {
  private listener?: (chunk: string) => void;
  on(_event: "data", listener: (chunk: Buffer | string) => void): void {
    this.listener = listener as (chunk: string) => void;
  }
  emit(text: string): void {
    this.listener?.(text);
  }
}

export class FakeChild implements ChildHandle {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  killed = false;
  private closeListener?: (code: number | null) => void;
  private errorListener?: (err: Error) => void;

  on(event: "close" | "error", listener: ((code: number | null) => void) & ((err: Error) => void)): void {
    if (event === "close") this.closeListener = listener;
    else this.errorListener = listener;
  }
  kill(): void {
    this.killed = true;
  }

  // Test drivers:
  out(text: string): void {
    this.stdout.emit(text);
  }
  close(code: number | null): void {
    this.closeListener?.(code);
  }
  error(err: Error): void {
    this.errorListener?.(err);
  }
}

/** Build a fake SpawnFn that records args and returns a controllable child. */
export function makeFakeSpawn(): {
  fn: SpawnFn;
  child: () => FakeChild | undefined;
  lastArgs: () => readonly string[] | undefined;
  lastCwd: () => string | undefined;
} {
  let lastChild: FakeChild | undefined;
  let lastArgs: readonly string[] | undefined;
  let lastCwd: string | undefined;
  const fn: SpawnFn = (_command, args, options) => {
    lastArgs = args;
    lastCwd = options.cwd;
    lastChild = new FakeChild();
    return lastChild;
  };
  return { fn, child: () => lastChild, lastArgs: () => lastArgs, lastCwd: () => lastCwd };
}
```

- [ ] **Step 3: Failing session test**

Create `packages/adapter-copilot/test/copilot-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@maestro/core";
import { CopilotSession } from "../src/copilot-session.js";
import { FakeChild } from "./fake-spawn.js";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("CopilotSession", () => {
  it("streams stdout as output, then done on exit 0", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();

    const events = collect(session.events);
    child.out("working on it\n");
    child.out("done editing files\n");
    child.close(0);

    expect(await events).toEqual([
      { kind: "output", text: "working on it\n" },
      { kind: "output", text: "done editing files\n" },
      { kind: "done", summary: "done editing files" },
    ]);
  });

  it("emits error on a non-zero exit", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.out("partial\n");
    child.close(1);
    const result = await events;
    expect(result.at(-1)).toMatchObject({ kind: "error" });
    expect((result.at(-1) as { message: string }).message).toContain("code 1");
  });

  it("emits error when the process fails to spawn", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.error(new Error("ENOENT"));
    const result = await events;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "error" });
    expect((result[0] as { message: string }).message).toContain("ENOENT");
  });

  it("drops whitespace-only chunks (spinner frames)", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.out("⠇⠋"); // pure spinner -> empty after cleaning -> dropped
    child.out("real output\n");
    child.close(0);
    const result = await events;
    expect(result.filter((e) => e.kind === "output")).toEqual([
      { kind: "output", text: "real output\n" },
    ]);
  });

  it("stop() kills the child and ends the stream without a terminal event", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.out("starting\n");
    session.stop();
    expect(child.killed).toBe(true);
    const result = await events;
    expect(result).toEqual([{ kind: "output", text: "starting\n" }]);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd packages/adapter-copilot && pnpm vitest run test/copilot-session.test.ts` → FAIL (module missing).

- [ ] **Step 5: Implement copilot-session.ts**

Create `packages/adapter-copilot/src/copilot-session.ts`:

```ts
import type { AgentEvent, AgentSession, ApprovalDecision } from "@maestro/core";
import { EventQueue } from "@maestro/core";
import { cleanOutput } from "./args.js";
import type { ChildHandle } from "./types.js";

export class CopilotSession implements AgentSession {
  private readonly queue = new EventQueue();
  private lastText = "";
  private settled = false;

  constructor(private readonly child: ChildHandle) {}

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  /** Begin consuming the child's streams. Call once, right after construction. */
  start(): void {
    this.child.stdout.on("data", (chunk) => {
      const text = cleanOutput(chunk.toString());
      if (text.trim().length === 0) return;
      this.lastText = text;
      this.queue.push({ kind: "output", text });
    });
    this.child.on("error", (err) => this.fail(`Failed to run copilot: ${err.message}`));
    this.child.on("close", (code) => {
      if (this.settled) return;
      this.settled = true;
      if (code === 0) {
        this.queue.push({ kind: "done", summary: this.summary() });
      } else {
        this.queue.push({ kind: "error", message: `copilot exited with code ${code ?? "unknown"}` });
      }
      this.queue.end();
    });
  }

  private summary(): string {
    const tail = this.lastText.trim().split("\n").filter(Boolean).pop();
    return tail && tail.length > 0 ? tail.slice(0, 200) : "Copilot run completed";
  }

  private fail(message: string): void {
    if (this.settled) return;
    this.settled = true;
    this.queue.push({ kind: "error", message });
    this.queue.end();
  }

  send(_input: string): void {
    /* v1: `copilot -p` is one-shot; mid-run steering awaits the ACP upgrade. */
  }

  respond(_approvalId: string, _decision: ApprovalDecision): void {
    /* v1: no interactive approvals (the agent runs --allow-all in its worktree). */
  }

  stop(): void {
    if (this.settled) return;
    this.settled = true;
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* already exited */
    }
    this.queue.end();
  }
}
```

- [ ] **Step 6: Run, typecheck, commit**

Run: `cd packages/adapter-copilot && pnpm vitest run test/copilot-session.test.ts` → PASS (5).
Run: `cd packages/adapter-copilot && pnpm exec tsc --noEmit` → clean.

```bash
git add packages/adapter-copilot/src/types.ts packages/adapter-copilot/src/copilot-session.ts packages/adapter-copilot/test/fake-spawn.ts packages/adapter-copilot/test/copilot-session.test.ts
git commit -m "feat(adapter-copilot): CopilotSession streams stdout and reports exit"
```

---

### Task 4: `CopilotAdapter`

**Files:** Create `src/adapter.ts`; Test `test/adapter.test.ts`

- [ ] **Step 1: Failing adapter test**

Create `packages/adapter-copilot/test/adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent, Role, Task, Workspace } from "@maestro/core";
import { CopilotAdapter } from "../src/adapter.js";
import { makeFakeSpawn } from "./fake-spawn.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "copilot", model: "claude-sonnet-4.6" },
  autonomy: "yolo",
};
const task: Task = { id: "t1", description: "add caching", roleName: "Implementer" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/wt/a1", branch: "agent/a1" };

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("CopilotAdapter", () => {
  it("exposes id and capabilities", () => {
    const adapter = new CopilotAdapter({ spawn: makeFakeSpawn().fn });
    expect(adapter.id).toBe("copilot");
    expect(adapter.capabilities).toEqual({
      streaming: true,
      structuredEvents: false,
      approvals: false,
      steerable: false,
    });
  });

  it("health reflects the injected env", async () => {
    expect((await new CopilotAdapter({ env: { GH_TOKEN: "x" } }).health()).ok).toBe(true);
    expect((await new CopilotAdapter({ env: {} }).health()).ok).toBe(false);
  });

  it("spawns copilot with the worktree cwd and correct argv, and runs to done", async () => {
    const fake = makeFakeSpawn();
    const adapter = new CopilotAdapter({ spawn: fake.fn });

    const session = adapter.start(task, workspace, role);
    const events = collect(session.events);

    expect(fake.lastCwd()).toBe("/tmp/wt/a1");
    expect(fake.lastArgs()).toEqual([
      "-C",
      "/tmp/wt/a1",
      "-p",
      "add caching",
      "-s",
      "--no-ask-user",
      "--allow-all",
      "--model",
      "claude-sonnet-4.6",
    ]);

    fake.child()!.out("edited cache.ts\n");
    fake.child()!.close(0);

    expect(await events).toEqual([
      { kind: "output", text: "edited cache.ts\n" },
      { kind: "done", summary: "edited cache.ts" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/adapter-copilot && pnpm vitest run test/adapter.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement adapter.ts**

Create `packages/adapter-copilot/src/adapter.ts`:

```ts
import { spawn as nodeSpawn } from "node:child_process";
import type {
  AgentSession,
  EngineAdapter,
  HealthStatus,
  Role,
  Task,
  Workspace,
} from "@maestro/core";
import { buildArgs } from "./args.js";
import { resolveAuth } from "./auth.js";
import { COPILOT_CAPABILITIES } from "./capabilities.js";
import { CopilotSession } from "./copilot-session.js";
import type { ChildHandle, SpawnFn } from "./types.js";

/** Default: spawn the real `copilot` binary with piped stdio. The cast bridges
 *  Node's ChildProcess (nullable stdio) to our ChildHandle at the boundary. */
const defaultSpawn: SpawnFn = (command, args, options) =>
  nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as ChildHandle;

export interface CopilotAdapterOptions {
  /** Injectable for testing; defaults to node:child_process.spawn. */
  spawn?: SpawnFn;
  /** Injectable for testing; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** The binary name; defaults to "copilot". */
  command?: string;
}

export class CopilotAdapter implements EngineAdapter {
  readonly id = "copilot";
  readonly capabilities = COPILOT_CAPABILITIES;
  private readonly spawnFn: SpawnFn;
  private readonly env: Record<string, string | undefined>;
  private readonly command: string;

  constructor(opts: CopilotAdapterOptions = {}) {
    this.spawnFn = opts.spawn ?? defaultSpawn;
    this.env = opts.env ?? process.env;
    this.command = opts.command ?? "copilot";
  }

  health(): Promise<HealthStatus> {
    return Promise.resolve(resolveAuth(this.env));
  }

  start(task: Task, workspace: Workspace, role: Role): AgentSession {
    const args = buildArgs(task, workspace, role);
    const child = this.spawnFn(this.command, args, {
      cwd: workspace.path,
      env: this.env as NodeJS.ProcessEnv,
    });
    const session = new CopilotSession(child);
    session.start();
    return session;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/adapter-copilot && pnpm vitest run test/adapter.test.ts` → PASS (3).

- [ ] **Step 5: Typecheck and commit**

Run: `cd packages/adapter-copilot && pnpm exec tsc --noEmit` → clean.

```bash
git add packages/adapter-copilot/src/adapter.ts packages/adapter-copilot/test/adapter.test.ts
git commit -m "feat(adapter-copilot): CopilotAdapter implementing EngineAdapter"
```

---

### Task 5: Conformance through the real Orchestrator

**Files:** Test `test/conformance.test.ts`

- [ ] **Step 1: Conformance test**

Create `packages/adapter-copilot/test/conformance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeWorkspaceProvider, Orchestrator } from "@maestro/core";
import type { Role } from "@maestro/core";
import { CopilotAdapter } from "../src/adapter.js";
import { makeFakeSpawn } from "./fake-spawn.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "copilot", model: "claude-sonnet-4.6" },
  autonomy: "yolo",
};

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("CopilotAdapter conformance via Orchestrator", () => {
  it("spawns, streams, and reaches done through the orchestrator", async () => {
    const fake = makeFakeSpawn();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new CopilotAdapter({ spawn: fake.fn }));

    const agent = orch.spawn("Implementer", "add a feature");
    await waitForState(orch, agent.id, "working");

    fake.child()!.out("implementing\n");
    fake.child()!.close(0);

    await waitForState(orch, agent.id, "done");
    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.log.map((e) => e.kind)).toEqual(["output", "done"]);
  });

  it("reaches error on a non-zero exit", async () => {
    const fake = makeFakeSpawn();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new CopilotAdapter({ spawn: fake.fn }));

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "working");

    fake.child()!.close(1);
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toContain("code 1");
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `cd packages/adapter-copilot && pnpm vitest run test/conformance.test.ts` → PASS (2).
NOTE: the test waits for `"working"` before driving the fake child, because the orchestrator creates the workspace asynchronously before calling `adapter.start`.

- [ ] **Step 3: Commit**

```bash
git add packages/adapter-copilot/test/conformance.test.ts
git commit -m "test(adapter-copilot): conformance through the real Orchestrator"
```

---

### Task 6: Public exports, optional live smoke test, README, full gate

**Files:** Modify `src/index.ts`; Create `scripts/smoke.mts`, `README.md`; Test `test/index.test.ts`

- [ ] **Step 1: Failing index test**

Create `packages/adapter-copilot/test/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as adapter from "../src/index.js";

describe("public API", () => {
  it("exports the adapter and helpers", () => {
    expect(typeof adapter.CopilotAdapter).toBe("function");
    expect(typeof adapter.buildArgs).toBe("function");
    expect(typeof adapter.resolveAuth).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/adapter-copilot && pnpm vitest run test/index.test.ts` → FAIL.

- [ ] **Step 3: Update exports**

Replace `packages/adapter-copilot/src/index.ts` with:

```ts
export const MAESTRO_ADAPTER_COPILOT_VERSION = "0.0.0";

export { CopilotAdapter } from "./adapter.js";
export type { CopilotAdapterOptions } from "./adapter.js";
export { COPILOT_CAPABILITIES } from "./capabilities.js";
export { resolveAuth } from "./auth.js";
export { buildArgs, cleanOutput } from "./args.js";
export type { ChildHandle, SpawnFn } from "./types.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/adapter-copilot && pnpm vitest run test/index.test.ts` → PASS (1).

- [ ] **Step 5: Optional live smoke test**

Create `packages/adapter-copilot/scripts/smoke.mts`. MANUAL, OPTIONAL, not part of the gate. Requires `copilot` installed + a Copilot token, plus `MAESTRO_LIVE=1`. Imports the built package (run `pnpm --filter @maestro/adapter-copilot build` first).

```ts
// Run: MAESTRO_LIVE=1 COPILOT_GITHUB_TOKEN=... pnpm --filter @maestro/adapter-copilot smoke
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotAdapter } from "../dist/index.js";

if (process.env.MAESTRO_LIVE !== "1") {
  console.log("Skipping live smoke test (set MAESTRO_LIVE=1 to run).");
  process.exit(0);
}

// Throwaway git repo so the agent has a worktree to act on.
const dir = mkdtempSync(join(tmpdir(), "maestro-copilot-smoke-"));
execSync("git init -q && git commit -q --allow-empty -m init", { cwd: dir });

const adapter = new CopilotAdapter();
const health = await adapter.health();
console.log("health:", health);
if (!health.ok) process.exit(1);

const session = adapter.start(
  { id: "t", description: "Create a file HELLO.md containing 'Hello from Maestro'.", roleName: "R" },
  { agentId: "a", path: dir, branch: "smoke" },
  {
    name: "R",
    instructions: "Make the smallest possible change.",
    engine: { id: "copilot", model: "claude-sonnet-4.6" },
    autonomy: "yolo",
  },
);

for await (const event of session.events) {
  console.log(`[${event.kind}]`, JSON.stringify(event).slice(0, 200));
}
console.log("Smoke complete. Inspect the worktree:", dir);
console.log("Diff:\n", execSync("git -C " + dir + " status --porcelain").toString());
```

NOTE: this is what validates the real `copilot -p` streaming + exit behavior the unit tests model with the fake. If `copilot` is not installed/authed, `health()` reports it. If the model id is not in your entitlement, swap `--model` or use `"auto"`.

- [ ] **Step 6: README**

Create `packages/adapter-copilot/README.md`:

```markdown
# @maestro/adapter-copilot

The GitHub Copilot engine adapter for Maestro. Spawns the agentic Copilot CLI
(`copilot -p`) as a subprocess in an isolated git worktree, streams its output,
and reports completion on process exit.

## Auth

Reuses your **GitHub Copilot subscription** — no API key. Set a GitHub token with
Copilot access via `COPILOT_GITHUB_TOKEN` (or `GH_TOKEN` / `GITHUB_TOKEN`), or run
`gh auth login`. Requires the `copilot` binary (`npm install -g @github/copilot`,
v1.0.52+ recommended).

## Model

`--model` selects the underlying model *through* Copilot: `claude-sonnet-4.6`,
`gpt-5`, `gemini-3-pro`, `auto`, etc. (subscription-entitlement dependent). Set it
on the role's `engine.model`.

## v1 scope and limitations

- **Plain-text streaming.** Output is streamed as `output` events; there are no
  structured per-tool events. (`--output-format json` exists but its schema is
  undocumented — a future upgrade.)
- **No interactive approval.** Each agent runs `--allow-all --no-ask-user`, which is
  safe because it is sandboxed to its own worktree; the conductor reviews the **diff**
  before merging. Per-tool approval awaits the ACP-mode upgrade.
- **One-shot.** `copilot -p` runs once and exits; mid-run steering (`send`) is a no-op
  in v1 (`--continue` chaining is a later addition).

Capabilities reported: `{ streaming: true, structuredEvents: false, approvals: false, steerable: false }`.

## Testing

`pnpm --filter @maestro/adapter-copilot test` runs the full suite with a fake spawn —
no `copilot` process, no network, no token. The optional live smoke test
(`pnpm --filter @maestro/adapter-copilot build && MAESTRO_LIVE=1 COPILOT_GITHUB_TOKEN=... pnpm --filter @maestro/adapter-copilot smoke`)
exercises the real `copilot`.
```

- [ ] **Step 7: Full milestone gate**

Run: `cd packages/adapter-copilot && pnpm vitest run && pnpm exec tsc --noEmit`
Expected: ALL pass (capabilities 1, auth 3, args 3, copilot-session 5, adapter 3, conformance 2, index 1 = 18 across 7 files), typecheck clean.

Also confirm core is unchanged: `cd ../core && pnpm vitest run` → 35 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-copilot/src/index.ts packages/adapter-copilot/test/index.test.ts packages/adapter-copilot/scripts/smoke.mts packages/adapter-copilot/README.md
git commit -m "feat(adapter-copilot): public API, live smoke script, README; pass full milestone gate"
```

---

## Definition of done (Milestone 2)

- `pnpm --filter @maestro/adapter-copilot test` green (18 tests), `typecheck` clean.
- `CopilotAdapter` implements `EngineAdapter`: spawns `copilot -p` in the worktree, streams stdout as `output`, reports `done`/`error` on exit, and `stop()` kills the process.
- Validated end-to-end through the real `Orchestrator` (run + error), entirely offline.
- An optional, gated live smoke test exists to validate the real `copilot` wiring.

## Risks and verification notes

- **Plain-text completion fidelity.** Unit tests model "stdout chunks → exit code → done/error" with the fake; the live smoke test is what confirms real `copilot -p` streams + exits as assumed. Run it once before relying on the adapter.
- **CLI is fast-moving.** Pin/require `copilot` v1.0.52+ (`-C`, `--allow-all` enforcement). Verify flags against `copilot --help` at integration. Windows older-version `-p "multi word"` tokenization bug — prefer recent versions, or pass the prompt via stdin if needed.
- **Undocumented JSONL schema.** The structured `--output-format json` upgrade requires capturing real output to write a parser; out of scope for v1.
- **Diff is the deliverable.** The review-the-diff product value depends on M3 (Workspace Manager) computing the worktree diff — this adapter intentionally emits `done` without a diff.

## What this unlocks (next)

- **Milestone 3:** Workspace Manager — real `git worktree` per agent, compute the diff on completion (the conductor's review surface), serialized merge, and `cleanup` wiring on terminal transitions. This is what turns the streamed runs into the "review the diff, merge" product.
- **Milestone 4:** VS Code extension shell + webview cockpit (roster, live output, diff review, merge) rendering `OrchestratorEvent`s.
- **Later:** structured `--output-format json` parsing and `--acp` mode (real per-tool approval + richer events), once that interface is GA/stable.

## Self-review notes

- **Spec coverage:** implements the Copilot-first build-order step 2 — a real adapter that spawns `copilot -p` and proves the M1 contract against a real engine, with honest capability degradation (`approvals/structuredEvents/steerable: false`). Real worktrees, diff, and the UI are deferred (M3/M4) and listed.
- **Type consistency:** `ChildHandle` / `SpawnFn` defined once in `types.ts`; `buildArgs`/`cleanOutput`/`resolveAuth` reused; `start(task, workspace, role)` matches the M2-refined contract; `done` emitted without a diff (M1 made it optional).
- **No placeholders:** every code step has complete, runnable code and exact commands with expected results.
```


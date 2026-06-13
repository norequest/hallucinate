# Maestro Core Orchestrator Implementation Plan (Milestone 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-TypeScript orchestration brain (adapter contract, a scriptable FakeEngineAdapter, and the agent state machine) that drives a team of AI agents, fully tested with no VS Code dependency and no real CLI.

**Architecture:** A framework-free `@maestro/core` package. The `Orchestrator` owns a state machine over `Agent` records, talks only to the `EngineAdapter` interface, throttles concurrency, parks agents on approval, and emits `OrchestratorEvent`s for a future UI to render. The `FakeEngineAdapter` (a scripted test double) stands in for real engines so ~90% of the product is testable offline.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, pnpm workspace. Zero runtime dependencies.

---

## Why this milestone first

Build-order step 1 from the design doc (`2026-06-14-maestro-vscode-design.md`). The design's central bet is "the adapter contract is the whole product." This milestone proves that contract and the orchestrator brain against a fake engine before a line of UI or a real CLI adapter is written. If the contract is wrong, we find out here, cheaply.

## File Structure

```
maestro-vscode/
  pnpm-workspace.yaml            # workspace root (new)
  package.json                   # root, private (new)
  packages/
    core/
      package.json               # @maestro/core
      tsconfig.json
      vitest.config.ts
      src/
        types.ts                 # data types: Task, Workspace, Diff, Capabilities,
                                 #   AgentEvent, AgentState, Role, Agent,
                                 #   OrchestratorEvent, OrchestratorConfig
        adapter.ts               # EngineAdapter, AgentSession, HealthStatus, ApprovalDecision
        events.ts                # helpers: isTerminalState, type guards
        emitter.ts               # tiny typed Emitter<T>
        event-queue.ts           # push-based AsyncIterable<AgentEvent>
        fake-adapter.ts          # FakeEngineAdapter + FakeSession (test double)
        workspace.ts             # WorkspaceProvider interface + FakeWorkspaceProvider
        orchestrator.ts          # the brain
        index.ts                 # public exports
      test/
        events.test.ts
        emitter.test.ts
        event-queue.test.ts
        fake-adapter.test.ts
        orchestrator.happy.test.ts
        orchestrator.approval.test.ts
        orchestrator.errors.test.ts
        orchestrator.concurrency.test.ts
        orchestrator.control.test.ts
        index.test.ts
```

Each file has one responsibility. The orchestrator never imports a concrete adapter or VS Code; it depends only on `adapter.ts` and `workspace.ts` interfaces.

---

### Task 0: Scaffold the workspace and core package

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts` (placeholder)
- Create: `.gitignore`

- [ ] **Step 1: Create the workspace file**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create the root package.json**

Create `package.json`:

```json
{
  "name": "maestro-vscode",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 3: Create the core package.json**

Create `packages/core/package.json`:

```json
{
  "name": "@maestro/core",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Create the tsconfig**

Create `packages/core/tsconfig.json`:

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
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: Create the vitest config**

Create `packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 6: Create a placeholder index so the package resolves**

Create `packages/core/src/index.ts`:

```ts
export const MAESTRO_CORE_VERSION = "0.0.0";
```

- [ ] **Step 7: Create .gitignore**

Create `.gitignore`:

```gitignore
node_modules/
dist/
packages/*/dist/
.conductor/.runtime/
```

- [ ] **Step 8: Install dependencies**

Run: `pnpm install`
Expected: installs vitest, typescript, @types/node under `packages/core`; creates `pnpm-lock.yaml`.

- [ ] **Step 9: Verify the toolchain runs**

Run: `cd packages/core && pnpm vitest run`
Expected: vitest reports "No test files found" (exit 0) or runs zero tests. This confirms the runner works.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace and @maestro/core package"
```

---

### Task 1: Core types and adapter contract

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/adapter.ts`
- Create: `packages/core/src/events.ts`
- Test: `packages/core/test/events.test.ts`

- [ ] **Step 1: Write the data types**

Create `packages/core/src/types.ts`:

```ts
/** A unit of work assigned to a role. */
export interface Task {
  id: string;
  description: string;
  roleName: string;
}

/** An isolated checkout an agent works in (real worktree comes in a later milestone). */
export interface Workspace {
  agentId: string;
  path: string;
  branch: string;
}

/** A summary of what an agent changed. */
export interface Diff {
  files: string[];
  patch: string;
}

/** What an engine adapter can do; drives UI graceful degradation. */
export interface Capabilities {
  streaming: boolean;
  structuredEvents: boolean;
  approvals: boolean;
  steerable: boolean;
}

/** The lifecycle state of an agent, owned by the orchestrator. */
export type AgentState =
  | "preparing"
  | "working"
  | "awaiting-approval"
  | "done"
  | "error"
  | "stopped"
  // reserved for the Workspace Manager milestone:
  | "merged"
  | "discarded";

/** States an adapter itself reports via a `status` event. */
export type EngineState = "working" | "awaiting-approval";

/** The common event stream every adapter emits. */
export type AgentEvent =
  | { kind: "output"; text: string }
  | { kind: "action"; tool: string; detail: unknown }
  | { kind: "approval"; id: string; detail: unknown }
  | { kind: "status"; state: EngineState }
  | { kind: "done"; summary: string; diff: Diff }
  | { kind: "error"; message: string };

/** A reusable worker template. */
export interface Role {
  name: string;
  instructions: string;
  engine: { id: string; model?: string };
  autonomy: "manual" | "auto-approve-safe" | "yolo";
}

/** A running instance of a role on a task. */
export interface Agent {
  id: string;
  task: Task;
  role: Role;
  state: AgentState;
  log: AgentEvent[];
  summary?: string;
  diff?: Diff;
  error?: string;
  pendingApprovalId?: string;
  workspace?: Workspace;
}

/** Events the orchestrator emits for a UI to render. */
export type OrchestratorEvent =
  | { kind: "agent-added"; agent: Agent }
  | { kind: "agent-updated"; agent: Agent }
  | { kind: "agent-event"; agentId: string; event: AgentEvent };

export interface OrchestratorConfig {
  maxParallelAgents: number;
}
```

- [ ] **Step 2: Write the adapter contract**

Create `packages/core/src/adapter.ts`:

```ts
import type { AgentEvent, Capabilities, Task, Workspace } from "./types.js";

export type ApprovalDecision = "allow" | "deny";

export interface HealthStatus {
  ok: boolean;
  detail?: string;
}

/** A live run of one engine on one task. */
export interface AgentSession {
  readonly events: AsyncIterable<AgentEvent>;
  /** Inject extra guidance mid-run (steer). */
  send(input: string): void;
  /** Answer a pending approval. */
  respond(approvalId: string, decision: ApprovalDecision): void;
  /** Cancel cleanly. */
  stop(): void;
}

/** The only thing the orchestrator knows about an engine. */
export interface EngineAdapter {
  readonly id: string;
  readonly capabilities: Capabilities;
  start(task: Task, workspace: Workspace): AgentSession;
  health(): Promise<HealthStatus>;
}
```

- [ ] **Step 3: Write the failing test for event helpers**

Create `packages/core/test/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isTerminalState } from "../src/events.js";

describe("isTerminalState", () => {
  it("treats done, error, stopped, merged, discarded as terminal", () => {
    expect(isTerminalState("done")).toBe(true);
    expect(isTerminalState("error")).toBe(true);
    expect(isTerminalState("stopped")).toBe(true);
    expect(isTerminalState("merged")).toBe(true);
    expect(isTerminalState("discarded")).toBe(true);
  });

  it("treats preparing, working, awaiting-approval as non-terminal", () => {
    expect(isTerminalState("preparing")).toBe(false);
    expect(isTerminalState("working")).toBe(false);
    expect(isTerminalState("awaiting-approval")).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd packages/core && pnpm vitest run test/events.test.ts`
Expected: FAIL, cannot find module `../src/events.js` (file not created yet).

- [ ] **Step 5: Implement the event helpers**

Create `packages/core/src/events.ts`:

```ts
import type { AgentState } from "./types.js";

const TERMINAL: ReadonlySet<AgentState> = new Set<AgentState>([
  "done",
  "error",
  "stopped",
  "merged",
  "discarded",
]);

export function isTerminalState(state: AgentState): boolean {
  return TERMINAL.has(state);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/events.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `cd packages/core && pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/adapter.ts packages/core/src/events.ts packages/core/test/events.test.ts
git commit -m "feat(core): add data types, adapter contract, and state helpers"
```

---

### Task 2: Typed event emitter

**Files:**
- Create: `packages/core/src/emitter.ts`
- Test: `packages/core/test/emitter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/emitter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Emitter } from "../src/emitter.js";

describe("Emitter", () => {
  it("delivers events to all listeners", () => {
    const e = new Emitter<number>();
    const a: number[] = [];
    const b: number[] = [];
    e.on((n) => a.push(n));
    e.on((n) => b.push(n));
    e.emit(1);
    e.emit(2);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
  });

  it("stops delivering after unsubscribe", () => {
    const e = new Emitter<string>();
    const seen: string[] = [];
    const off = e.on((s) => seen.push(s));
    e.emit("x");
    off();
    e.emit("y");
    expect(seen).toEqual(["x"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && pnpm vitest run test/emitter.test.ts`
Expected: FAIL, cannot find module `../src/emitter.js`.

- [ ] **Step 3: Implement the emitter**

Create `packages/core/src/emitter.ts`:

```ts
export type Listener<T> = (event: T) => void;

export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  /** Subscribe; returns an unsubscribe function. */
  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: T): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/emitter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/emitter.ts packages/core/test/emitter.test.ts
git commit -m "feat(core): add typed Emitter"
```

---

### Task 3: Push-based async event queue

**Files:**
- Create: `packages/core/src/event-queue.ts`
- Test: `packages/core/test/event-queue.test.ts`

This is the backbone of the FakeSession: a queue you push events into and consume with `for await`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/event-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventQueue } from "../src/event-queue.js";
import type { AgentEvent } from "../src/types.js";

async function drain(q: EventQueue): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of q) out.push(e);
  return out;
}

describe("EventQueue", () => {
  it("yields buffered events pushed before consumption, then ends", async () => {
    const q = new EventQueue();
    q.push({ kind: "output", text: "a" });
    q.push({ kind: "output", text: "b" });
    q.end();
    expect(await drain(q)).toEqual([
      { kind: "output", text: "a" },
      { kind: "output", text: "b" },
    ]);
  });

  it("delivers events pushed after the consumer is already waiting", async () => {
    const q = new EventQueue();
    const collected = drain(q);
    q.push({ kind: "output", text: "late" });
    q.end();
    expect(await collected).toEqual([{ kind: "output", text: "late" }]);
  });

  it("ignores pushes after end", async () => {
    const q = new EventQueue();
    q.push({ kind: "output", text: "kept" });
    q.end();
    q.push({ kind: "output", text: "dropped" });
    expect(await drain(q)).toEqual([{ kind: "output", text: "kept" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && pnpm vitest run test/event-queue.test.ts`
Expected: FAIL, cannot find module `../src/event-queue.js`.

- [ ] **Step 3: Implement the queue**

Create `packages/core/src/event-queue.ts`:

```ts
import type { AgentEvent } from "./types.js";

type Resolver = (result: IteratorResult<AgentEvent>) => void;

/**
 * A single-consumer, push-based async iterable of AgentEvents.
 * Invariant: a pending resolver only exists when the buffer is empty,
 * so push() either hands off to a waiter or buffers, never both.
 */
export class EventQueue implements AsyncIterable<AgentEvent> {
  private readonly buffer: AgentEvent[] = [];
  private readonly resolvers: Resolver[] = [];
  private ended = false;

  push(event: AgentEvent): void {
    if (this.ended) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    let resolver: Resolver | undefined;
    while ((resolver = this.resolvers.shift())) {
      resolver({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return {
      next: (): Promise<IteratorResult<AgentEvent>> => {
        const buffered = this.buffer.shift();
        if (buffered !== undefined) {
          return Promise.resolve({ value: buffered, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<AgentEvent>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/event-queue.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/event-queue.ts packages/core/test/event-queue.test.ts
git commit -m "feat(core): add push-based async EventQueue"
```

---

### Task 4: FakeEngineAdapter and FakeSession

**Files:**
- Create: `packages/core/src/fake-adapter.ts`
- Test: `packages/core/test/fake-adapter.test.ts`

The scriptable test double. It emits a list of events in order and, on an `approval` event, pauses until `respond()` is called, modelling a real engine blocking for permission.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/fake-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import type { AgentEvent, Task, Workspace } from "../src/types.js";

const task: Task = { id: "t1", description: "do it", roleName: "Impl" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/a1", branch: "agent/a1" };

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("FakeEngineAdapter", () => {
  it("reports configured capabilities and health", async () => {
    const adapter = new FakeEngineAdapter({
      script: [],
      capabilities: { approvals: false },
    });
    expect(adapter.capabilities).toEqual({
      streaming: true,
      structuredEvents: true,
      approvals: false,
      steerable: true,
    });
    expect(await adapter.health()).toEqual({ ok: true });
  });

  it("reports unhealthy when configured", async () => {
    const adapter = new FakeEngineAdapter({ script: [], healthy: false });
    expect(await adapter.health()).toEqual({ ok: false, detail: "fake unhealthy" });
  });

  it("emits the scripted events in order then ends", async () => {
    const adapter = new FakeEngineAdapter({
      script: [
        { kind: "output", text: "hello" },
        { kind: "done", summary: "ok", diff: { files: [], patch: "" } },
      ],
    });
    const session = adapter.start(task, workspace);
    expect(await collect(session.events)).toEqual([
      { kind: "output", text: "hello" },
      { kind: "done", summary: "ok", diff: { files: [], patch: "" } },
    ]);
  });

  it("pauses on an approval event until respond() is called", async () => {
    const adapter = new FakeEngineAdapter({
      script: [
        { kind: "approval", id: "ap1", detail: "run npm test" },
        { kind: "done", summary: "ok", diff: { files: [], patch: "" } },
      ],
    });
    const session = adapter.start(task, workspace);
    const iterator = session.events[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toEqual({ kind: "approval", id: "ap1", detail: "run npm test" });

    // The next event must not arrive until we respond.
    let resolved = false;
    const secondPromise = iterator.next().then((r) => {
      resolved = true;
      return r;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    session.respond("ap1", "allow");
    const second = await secondPromise;
    expect(second.value).toEqual({ kind: "done", summary: "ok", diff: { files: [], patch: "" } });
    expect(session.decisions).toEqual([{ id: "ap1", decision: "allow" }]);
  });

  it("records send() calls", async () => {
    const adapter = new FakeEngineAdapter({ script: [] });
    const session = adapter.start(task, workspace);
    session.send("try harder");
    expect(session.sent).toEqual(["try harder"]);
  });

  it("stop() ends the stream early", async () => {
    const adapter = new FakeEngineAdapter({
      script: [{ kind: "approval", id: "ap1", detail: null }],
    });
    const session = adapter.start(task, workspace);
    const iterator = session.events[Symbol.asyncIterator]();
    await iterator.next(); // the approval event
    session.stop();
    const ended = await iterator.next();
    expect(ended.done).toBe(true);
    expect(session.stopped).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && pnpm vitest run test/fake-adapter.test.ts`
Expected: FAIL, cannot find module `../src/fake-adapter.js`.

- [ ] **Step 3: Implement the fake adapter and session**

Create `packages/core/src/fake-adapter.ts`:

```ts
import type {
  AgentSession,
  ApprovalDecision,
  EngineAdapter,
  HealthStatus,
} from "./adapter.js";
import { EventQueue } from "./event-queue.js";
import type { AgentEvent, Capabilities, Task, Workspace } from "./types.js";

export interface FakeAdapterOptions {
  id?: string;
  capabilities?: Partial<Capabilities>;
  /** Events emitted in order; the session pauses after each `approval` until respond(). */
  script: AgentEvent[];
  healthy?: boolean;
}

const DEFAULT_CAPABILITIES: Capabilities = {
  streaming: true,
  structuredEvents: true,
  approvals: true,
  steerable: true,
};

export class FakeEngineAdapter implements EngineAdapter {
  readonly id: string;
  readonly capabilities: Capabilities;
  private readonly script: AgentEvent[];
  private readonly healthy: boolean;
  /** The most recently started session, for test assertions. */
  lastSession?: FakeSession;

  constructor(options: FakeAdapterOptions) {
    this.id = options.id ?? "fake";
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    this.script = options.script;
    this.healthy = options.healthy ?? true;
  }

  health(): Promise<HealthStatus> {
    return Promise.resolve(
      this.healthy ? { ok: true } : { ok: false, detail: "fake unhealthy" },
    );
  }

  start(_task: Task, _workspace: Workspace): AgentSession {
    const session = new FakeSession(this.script);
    this.lastSession = session;
    void session.run();
    return session;
  }
}

export class FakeSession implements AgentSession {
  private readonly queue = new EventQueue();
  private readonly approvalWaiters = new Map<string, () => void>();
  readonly sent: string[] = [];
  readonly decisions: Array<{ id: string; decision: ApprovalDecision }> = [];
  stopped = false;

  constructor(private readonly script: AgentEvent[]) {}

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  async run(): Promise<void> {
    for (const event of this.script) {
      if (this.stopped) break;
      this.queue.push(event);
      if (event.kind === "approval") {
        await new Promise<void>((resolve) => {
          this.approvalWaiters.set(event.id, resolve);
        });
      }
    }
    this.queue.end();
  }

  send(input: string): void {
    this.sent.push(input);
  }

  respond(approvalId: string, decision: ApprovalDecision): void {
    this.decisions.push({ id: approvalId, decision });
    const waiter = this.approvalWaiters.get(approvalId);
    if (waiter) {
      this.approvalWaiters.delete(approvalId);
      waiter();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const waiter of this.approvalWaiters.values()) waiter();
    this.approvalWaiters.clear();
    this.queue.end();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/fake-adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fake-adapter.ts packages/core/test/fake-adapter.test.ts
git commit -m "feat(core): add scriptable FakeEngineAdapter test double"
```

---

### Task 5: WorkspaceProvider interface and fake

**Files:**
- Create: `packages/core/src/workspace.ts`
- Test: folded into orchestrator tests (the fake is trivial; covered via orchestrator happy path in Task 6)

- [ ] **Step 1: Implement the interface and fake**

Create `packages/core/src/workspace.ts`:

```ts
import type { Workspace } from "./types.js";

/** Abstracts worktree creation so the orchestrator stays pure and testable. */
export interface WorkspaceProvider {
  create(agentId: string): Promise<Workspace>;
  cleanup(agentId: string): Promise<void>;
}

/** In-memory provider for tests and for the no-real-CLI milestone. */
export class FakeWorkspaceProvider implements WorkspaceProvider {
  readonly created: string[] = [];
  readonly cleaned: string[] = [];
  private failOn?: string;

  /** Configure the provider to throw when creating a workspace for `agentId`. */
  failCreateFor(agentId: string): void {
    this.failOn = agentId;
  }

  create(agentId: string): Promise<Workspace> {
    if (this.failOn === agentId) {
      return Promise.reject(new Error("worktree add failed"));
    }
    this.created.push(agentId);
    return Promise.resolve({
      agentId,
      path: `/tmp/maestro/${agentId}`,
      branch: `agent/${agentId}`,
    });
  }

  cleanup(agentId: string): Promise<void> {
    this.cleaned.push(agentId);
    return Promise.resolve();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/core && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/workspace.ts
git commit -m "feat(core): add WorkspaceProvider interface and in-memory fake"
```

---

### Task 6: Orchestrator skeleton and happy path

**Files:**
- Create: `packages/core/src/orchestrator.ts`
- Test: `packages/core/test/orchestrator.happy.test.ts`

The brain. This task builds spawn plus the happy path (output then done), registration of roles/adapters, and event emission.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/orchestrator.happy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { OrchestratorEvent, Role } from "../src/types.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "fake" },
  autonomy: "manual",
};

function deterministicIds(): () => string {
  let n = 0;
  return () => `agent-${++n}`;
}

/** Resolves once the agent reaches a terminal-ish target state. */
function waitForState(
  orch: Orchestrator,
  agentId: string,
  target: string,
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator happy path", () => {
  it("spawns an agent, runs it, and reaches done with summary and diff", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces, deterministicIds());
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({
        script: [
          { kind: "output", text: "writing code" },
          { kind: "done", summary: "added rate limiting", diff: { files: ["a.ts"], patch: "diff" } },
        ],
      }),
    );

    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));

    const agent = orch.spawn("Implementer", "add rate limiting");
    expect(agent.state).toBe("preparing");

    await waitForState(orch, agent.id, "done");

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.summary).toBe("added rate limiting");
    expect(final.diff).toEqual({ files: ["a.ts"], patch: "diff" });
    expect(final.log.map((e) => e.kind)).toEqual(["output", "done"]);
    expect(workspaces.created).toEqual([agent.id]);
    expect(events[0]).toEqual({ kind: "agent-added", agent: expect.objectContaining({ id: agent.id }) });
  });

  it("throws when spawning an unknown role", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    expect(() => orch.spawn("Nope", "x")).toThrow("Unknown role: Nope");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && pnpm vitest run test/orchestrator.happy.test.ts`
Expected: FAIL, cannot find module `../src/orchestrator.js`.

- [ ] **Step 3: Implement the orchestrator**

Create `packages/core/src/orchestrator.ts`:

```ts
import type { AgentSession, ApprovalDecision, EngineAdapter } from "./adapter.js";
import { Emitter } from "./emitter.js";
import type {
  Agent,
  AgentEvent,
  AgentState,
  OrchestratorConfig,
  OrchestratorEvent,
  Role,
  Task,
} from "./types.js";
import type { WorkspaceProvider } from "./workspace.js";

export class Orchestrator {
  private readonly agents = new Map<string, Agent>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly roles = new Map<string, Role>();
  private readonly adapters = new Map<string, EngineAdapter>();
  private readonly queue: string[] = [];
  private readonly stopping = new Set<string>();
  private readonly emitter = new Emitter<OrchestratorEvent>();
  private readonly idGen: () => string;
  private running = 0;

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly workspaces: WorkspaceProvider,
    idGen?: () => string,
  ) {
    let n = 0;
    this.idGen = idGen ?? (() => `agent-${++n}`);
  }

  registerAdapter(adapter: EngineAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  registerRole(role: Role): void {
    this.roles.set(role.name, role);
  }

  on(listener: (event: OrchestratorEvent) => void): () => void {
    return this.emitter.on(listener);
  }

  getAgents(): Agent[] {
    return [...this.agents.values()];
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  spawn(roleName: string, description: string): Agent {
    const role = this.roles.get(roleName);
    if (!role) throw new Error(`Unknown role: ${roleName}`);
    const id = this.idGen();
    const task: Task = { id: `task-${id}`, description, roleName };
    const agent: Agent = { id, task, role, state: "preparing", log: [] };
    this.agents.set(id, agent);
    this.emitter.emit({ kind: "agent-added", agent });
    this.tryStart(agent);
    return agent;
  }

  private tryStart(agent: Agent): void {
    if (this.running >= this.config.maxParallelAgents) {
      this.queue.push(agent.id);
      return;
    }
    this.running++;
    void this.launch(agent);
  }

  private async launch(agent: Agent): Promise<void> {
    const adapter = this.adapters.get(agent.role.engine.id);
    if (!adapter) {
      this.fail(agent, `No adapter for engine ${agent.role.engine.id}`);
      this.release();
      return;
    }
    try {
      agent.workspace = await this.workspaces.create(agent.id);
    } catch (error) {
      this.fail(agent, `Workspace creation failed: ${(error as Error).message}`);
      this.release();
      return;
    }
    this.update(agent, "working");
    const session = adapter.start(agent.task, agent.workspace);
    this.sessions.set(agent.id, session);
    void this.consume(agent, session);
  }

  private async consume(agent: Agent, session: AgentSession): Promise<void> {
    try {
      for await (const event of session.events) {
        agent.log.push(event);
        this.emitter.emit({ kind: "agent-event", agentId: agent.id, event });
        this.applyEvent(agent, event);
      }
      if (agent.state === "working" || agent.state === "awaiting-approval") {
        if (this.stopping.has(agent.id)) {
          this.update(agent, "stopped");
        } else {
          this.fail(agent, "Engine stream ended without a terminal event");
        }
      }
    } catch (error) {
      this.fail(agent, `Session error: ${(error as Error).message}`);
    } finally {
      this.stopping.delete(agent.id);
      this.sessions.delete(agent.id);
      this.release();
    }
  }

  private applyEvent(agent: Agent, event: AgentEvent): void {
    switch (event.kind) {
      case "approval":
        agent.pendingApprovalId = event.id;
        this.update(agent, "awaiting-approval");
        break;
      case "status":
        this.update(agent, event.state);
        break;
      case "done":
        agent.summary = event.summary;
        agent.diff = event.diff;
        this.update(agent, "done");
        break;
      case "error":
        this.fail(agent, event.message);
        break;
      case "output":
      case "action":
        break;
    }
  }

  private release(): void {
    this.running--;
    const nextId = this.queue.shift();
    if (nextId) {
      const agent = this.agents.get(nextId);
      if (agent) this.tryStart(agent);
    }
  }

  private update(agent: Agent, state: AgentState): void {
    agent.state = state;
    this.emitter.emit({ kind: "agent-updated", agent });
  }

  private fail(agent: Agent, message: string): void {
    agent.error = message;
    this.update(agent, "error");
  }

  approve(agentId: string, approvalId: string, decision: ApprovalDecision): void {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "awaiting-approval") {
      throw new Error(`Agent ${agentId} is not awaiting approval`);
    }
    const session = this.sessions.get(agentId);
    if (!session) throw new Error(`No active session for ${agentId}`);
    session.respond(approvalId, decision);
    agent.pendingApprovalId = undefined;
    this.update(agent, "working");
  }

  steer(agentId: string, input: string): void {
    const session = this.sessions.get(agentId);
    if (!session) throw new Error(`No active session for ${agentId}`);
    session.send(input);
  }

  stop(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (!session) return;
    this.stopping.add(agentId);
    session.stop();
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return agent;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/orchestrator.happy.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestrator.ts packages/core/test/orchestrator.happy.test.ts
git commit -m "feat(core): add Orchestrator with spawn and happy-path run loop"
```

---

### Task 7: Approval parking and resume

**Files:**
- Modify: none (behavior already implemented in Task 6)
- Test: `packages/core/test/orchestrator.approval.test.ts`

This task proves the approval flow with dedicated tests. No new source if Task 6 is correct.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/orchestrator.approval.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { Role } from "../src/types.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "fake" },
  autonomy: "manual",
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

function build() {
  const workspaces = new FakeWorkspaceProvider();
  const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
  orch.registerRole(role);
  const adapter = new FakeEngineAdapter({
    script: [
      { kind: "approval", id: "ap1", detail: "run npm test" },
      { kind: "done", summary: "done", diff: { files: [], patch: "" } },
    ],
  });
  orch.registerAdapter(adapter);
  return { orch, adapter };
}

describe("Orchestrator approvals", () => {
  it("parks on approval, then resumes and completes when approved", async () => {
    const { orch, adapter } = build();
    const agent = orch.spawn("Implementer", "task");

    await waitForState(orch, agent.id, "awaiting-approval");
    expect(orch.getAgent(agent.id)!.pendingApprovalId).toBe("ap1");

    orch.approve(agent.id, "ap1", "allow");
    await waitForState(orch, agent.id, "done");

    expect(adapter.lastSession!.decisions).toEqual([{ id: "ap1", decision: "allow" }]);
    expect(orch.getAgent(agent.id)!.pendingApprovalId).toBeUndefined();
  });

  it("throws if approving an agent that is not awaiting approval", async () => {
    const { orch } = build();
    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "awaiting-approval");
    orch.approve(agent.id, "ap1", "allow");
    // now it is working/done, not awaiting
    expect(() => orch.approve(agent.id, "ap1", "allow")).toThrow("is not awaiting approval");
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/orchestrator.approval.test.ts`
Expected: PASS (2 tests). (If either fails, fix `orchestrator.ts` approval handling before continuing.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/orchestrator.approval.test.ts
git commit -m "test(core): cover orchestrator approval parking and resume"
```

---

### Task 8: Error handling

**Files:**
- Test: `packages/core/test/orchestrator.errors.test.ts`

Covers: explicit `error` event, stream ending without a terminal event, missing adapter, and workspace-creation failure.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/orchestrator.errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { Role } from "../src/types.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "fake" },
  autonomy: "manual",
};

const missingEngineRole: Role = { ...role, name: "Ghost", engine: { id: "nope" } };

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator error handling", () => {
  it("goes to error on an explicit error event", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({ script: [{ kind: "error", message: "boom" }] }),
    );
    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toBe("boom");
  });

  it("errors when the stream ends without a terminal event", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({ script: [{ kind: "output", text: "partial" }] }),
    );
    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toContain("without a terminal event");
  });

  it("errors when no adapter is registered for the role's engine", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(missingEngineRole);
    const agent = orch.spawn("Ghost", "task");
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toContain("No adapter for engine nope");
  });

  it("errors when workspace creation fails", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [] }));
    // agent id is deterministic default "agent-1"
    workspaces.failCreateFor("agent-1");
    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toContain("Workspace creation failed");
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/orchestrator.errors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/orchestrator.errors.test.ts
git commit -m "test(core): cover orchestrator error paths"
```

---

### Task 9: Concurrency limit and queue

**Files:**
- Test: `packages/core/test/orchestrator.concurrency.test.ts`

Proves that with `maxParallelAgents: 1`, a second spawn queues until the first finishes, and that the workspace for the queued agent is only created after a slot frees.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/orchestrator.concurrency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { Role } from "../src/types.js";

function role(engineId: string): Role {
  return { name: engineId, instructions: "x", engine: { id: engineId }, autonomy: "manual" };
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator concurrency", () => {
  it("queues a second agent until the first completes (max 1)", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);

    // Agent A pauses on approval (stays running); Agent B must wait.
    orch.registerRole(role("a"));
    orch.registerAdapter(
      new FakeEngineAdapter({
        id: "a",
        script: [
          { kind: "approval", id: "apA", detail: null },
          { kind: "done", summary: "A", diff: { files: [], patch: "" } },
        ],
      }),
    );
    orch.registerRole(role("b"));
    orch.registerAdapter(
      new FakeEngineAdapter({
        id: "b",
        script: [{ kind: "done", summary: "B", diff: { files: [], patch: "" } }],
      }),
    );

    const a = orch.spawn("a", "task A");
    const b = orch.spawn("b", "task B");

    await waitForState(orch, a.id, "awaiting-approval");

    // B is still queued: not started, no workspace yet.
    expect(orch.getAgent(b.id)!.state).toBe("preparing");
    expect(workspaces.created).toEqual([a.id]);

    // Finish A; B should now start and complete.
    orch.approve(a.id, "apA", "allow");
    await waitForState(orch, a.id, "done");
    await waitForState(orch, b.id, "done");

    expect(workspaces.created).toEqual([a.id, b.id]);
  });

  it("runs two agents in parallel when max is 2", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);
    orch.registerRole(role("a"));
    orch.registerAdapter(
      new FakeEngineAdapter({ id: "a", script: [{ kind: "approval", id: "x", detail: null }] }),
    );
    orch.registerRole(role("b"));
    orch.registerAdapter(
      new FakeEngineAdapter({ id: "b", script: [{ kind: "approval", id: "y", detail: null }] }),
    );

    const a = orch.spawn("a", "A");
    const b = orch.spawn("b", "B");
    await waitForState(orch, a.id, "awaiting-approval");
    await waitForState(orch, b.id, "awaiting-approval");

    // Both started concurrently.
    expect(new Set(workspaces.created)).toEqual(new Set([a.id, b.id]));
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/orchestrator.concurrency.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/orchestrator.concurrency.test.ts
git commit -m "test(core): cover concurrency limit and queueing"
```

---

### Task 10: Steering and stop

**Files:**
- Test: `packages/core/test/orchestrator.control.test.ts`

Proves `steer()` forwards input to the session, and `stop()` ends a running agent into the `stopped` state (not `error`).

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/orchestrator.control.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { Role } from "../src/types.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "fake" },
  autonomy: "manual",
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

describe("Orchestrator control", () => {
  it("forwards steer() input to the live session", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    const adapter = new FakeEngineAdapter({
      script: [{ kind: "approval", id: "ap", detail: null }],
    });
    orch.registerAdapter(adapter);

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "awaiting-approval");

    orch.steer(agent.id, "focus on the edge cases");
    expect(adapter.lastSession!.sent).toEqual(["focus on the edge cases"]);
  });

  it("stop() moves a running agent to stopped, not error", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({ script: [{ kind: "approval", id: "ap", detail: null }] }),
    );

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "awaiting-approval");

    orch.stop(agent.id);
    await waitForState(orch, agent.id, "stopped");
    expect(orch.getAgent(agent.id)!.state).toBe("stopped");
  });

  it("steer() throws when there is no active session", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    expect(() => orch.steer("missing", "hi")).toThrow("No active session for missing");
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/orchestrator.control.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/orchestrator.control.test.ts
git commit -m "test(core): cover steer and stop control paths"
```

---

### Task 11: Public exports and full-suite gate

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Replace `packages/core/test/index.test.ts` (create it):

```ts
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("public API", () => {
  it("exports the orchestrator and test doubles", () => {
    expect(typeof core.Orchestrator).toBe("function");
    expect(typeof core.FakeEngineAdapter).toBe("function");
    expect(typeof core.FakeWorkspaceProvider).toBe("function");
    expect(typeof core.Emitter).toBe("function");
    expect(typeof core.isTerminalState).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && pnpm vitest run test/index.test.ts`
Expected: FAIL (exports are undefined; index.ts still only has the version constant).

- [ ] **Step 3: Update the public exports**

Replace `packages/core/src/index.ts` with:

```ts
export const MAESTRO_CORE_VERSION = "0.0.0";

export * from "./types.js";
export * from "./adapter.js";
export { Orchestrator } from "./orchestrator.js";
export { Emitter } from "./emitter.js";
export { EventQueue } from "./event-queue.js";
export { isTerminalState } from "./events.js";
export { FakeEngineAdapter, FakeSession } from "./fake-adapter.js";
export { FakeWorkspaceProvider } from "./workspace.js";
export type { WorkspaceProvider } from "./workspace.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run test/index.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the FULL suite and typecheck (the milestone gate)**

Run: `cd packages/core && pnpm vitest run && pnpm typecheck`
Expected: ALL tests pass (events, emitter, event-queue, fake-adapter, and five orchestrator suites, index), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "feat(core): finalize public API and pass full milestone gate"
```

---

## Definition of done (Milestone 1)

- `pnpm --filter @maestro/core test` is green across all suites.
- `pnpm --filter @maestro/core typecheck` is clean.
- The `Orchestrator` drives the full agent lifecycle (`preparing -> working -> awaiting-approval <-> working -> done | error | stopped`) against the `FakeEngineAdapter` with no VS Code and no real CLI.
- The adapter contract (`EngineAdapter` / `AgentSession` / `AgentEvent` / `Capabilities`) is exercised end to end and ready for a real adapter to implement.

## What this unlocks (next milestones, separate plans)

- **Milestone 2:** Claude Code adapter implementing `EngineAdapter` via the Agent SDK (`stream-json`, `canUseTool`), validated with recorded fixtures, then live. Reuses the exact contract proven here.
- **Milestone 3:** Workspace Manager (real `git worktree` create/merge/conflict) replacing `FakeWorkspaceProvider`, plus the adapter conformance suite that every future adapter must pass.
- **Milestone 4:** VS Code extension shell and webview cockpit, rendering `OrchestratorEvent`s (roster, Stage cards, approval buttons, review/merge bar).
- **Milestone 5:** Generic ACP adapter (unlocks Gemini and Copilot from one implementation), per the verified research in the design doc.

## Self-review notes

- **Spec coverage:** This plan implements design-doc build-order step 1 (adapter contract + FakeEngineAdapter + orchestrator state machine). The approvals-degradation, real worktrees, UI, and real adapters are explicitly deferred to later milestones and listed above.
- **Type consistency:** `AgentState`, `AgentEvent` kinds, `Capabilities` fields, `ApprovalDecision`, and `OrchestratorEvent` shapes are defined once in `types.ts`/`adapter.ts` (Task 1) and reused verbatim in every later task and test.
- **No placeholders:** every code step contains complete, runnable code and every run step states the exact command and expected result.

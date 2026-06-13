# Maestro Claude Code Adapter Implementation Plan (Milestone 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first real engine adapter, `@maestro/adapter-claude`, driving Claude Code through the official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) and satisfying the `EngineAdapter` contract proven in Milestone 1, validated entirely offline with a fake `query` and verified end-to-end through the real `Orchestrator`.

**Architecture:** A new package `@maestro/adapter-claude` depending on `@maestro/core` and the Agent SDK. The adapter is a pure translator: it builds SDK `Options` from a `Role`, runs the injected `query()` over a push-based streaming-input channel, translates each `SDKMessage` into the common `AgentEvent` stream, and bridges the SDK's `canUseTool` callback to our `approval`/`respond()` round-trip. The real `query` is injected (default) so 100% of the logic is testable with a scripted fake (no SDK process, no network, no API key).

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, pnpm workspace, `@anthropic-ai/claude-agent-sdk`. Reuses `@maestro/core` (`EventQueue`, contract types, `Orchestrator`, `FakeWorkspaceProvider`).

---

## Why this milestone

Build-order step 2 from the design doc. M1 proved the `EngineAdapter` contract against a `FakeEngineAdapter`. M2 proves it against a *real* engine, excellently. Claude Code is chosen first because the Agent SDK is the cleanest path: typed event stream + a real approval-interception callback (`canUseTool`), the one capability that most needs proving.

## Verified Agent SDK facts (2026-06-14, from code.claude.com/docs/en/agent-sdk)

- **Package/import:** `npm install @anthropic-ai/claude-agent-sdk`; `import { query } from "@anthropic-ai/claude-agent-sdk"`. Exports types `Options`, `SDKMessage`, `PermissionResult`, `CanUseTool`, `SDKUserMessage`, `PermissionMode`.
- **`query({ prompt, options })`** returns a `Query` (an `AsyncGenerator<SDKMessage, void>` plus methods `interrupt()`, `streamInput(stream)`, `setPermissionMode()`, ...). `prompt` may be a `string` or an `AsyncIterable<SDKUserMessage>` (streaming input, enabling mid-run steering).
- **`Options`** fields we use: `model`, `cwd`, `systemPrompt` (`string` or `{ type:"preset", preset:"claude_code", append?:string }`), `permissionMode` (`"default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto"`), `canUseTool`, `includePartialMessages`, `allowedTools`/`disallowedTools`, `abortController`, `env`, `stderr`, `resume`, `maxTurns`.
- **`SDKMessage`** variants we parse: `type:"assistant"` (`message.content` holds Anthropic content blocks — `text` / `tool_use`), `type:"result"` (`subtype:"success"` with `result`, `total_cost_usd`, `num_turns`, `session_id`; or error subtypes `error_max_turns` / `error_during_execution` / `error_max_budget_usd` / `error_max_structured_output_retries` with `errors: string[]`, `is_error:true`), `type:"system"` (`subtype:"init"`, `session_id`). The terminal `result` message is the completion signal.
- **`canUseTool`** signature: `(toolName, input, { signal, toolUseID, ... }) => Promise<PermissionResult>`. `PermissionResult = { behavior:"allow", updatedInput? } | { behavior:"deny", message, interrupt? }`.
- **Auth (CRITICAL):** the Agent SDK authenticates with **`ANTHROPIC_API_KEY`** (or cloud-provider vars `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_ANTHROPIC_AWS` / `_FOUNDRY`). Anthropic's terms **prohibit third-party products from reusing claude.ai subscription login** for the Agent SDK. So this adapter requires an API key. (This corrects the design doc's "subscription reuse holds for Claude" note: it holds for the Codex/Gemini/Copilot CLIs, not the Claude Agent SDK.)

## Key decisions

- **Inject `query` for testability.** `ClaudeCodeAdapter` takes an optional `query` (defaults to the real SDK export). Tests pass a scripted fake; no SDK process or network in the unit suite. Same DI pattern as M1's `FakeWorkspaceProvider`.
- **Streaming-input mode.** The adapter always drives `query()` with an `AsyncIterable<SDKUserMessage>` (`InputChannel`), pushing the task first and additional `send()` input later — this honors `steerable: true`. On the terminal `result` message we end the input and `interrupt()` to terminate the session.
- **Approvals bridge the callback to the event stream.** `canUseTool` pushes an `{ kind:"approval", id: toolUseID, detail }` event and returns a promise parked until `respond(id, decision)` resolves it to a `PermissionResult`. This is the heart of why Claude is the first adapter.
- **`done.diff` is omitted.** The Agent SDK gives a text summary, not a diff; the real diff is derived by the Workspace Manager (M3). M1 already made `diff` optional on `done`.
- **`autonomy → permissionMode`:** `manual → "default"` (rely on `canUseTool` to intercept), `auto-approve-safe → "acceptEdits"`, `yolo → "bypassPermissions"`.

## File Structure

```
maestro-vscode/
  packages/
    adapter-claude/
      package.json                 # @maestro/adapter-claude
      tsconfig.json
      vitest.config.ts
      src/
        types.ts                   # narrow MaestroQuery + QueryFn; re-export SDK types
        capabilities.ts            # CLAUDE_CAPABILITIES + permissionModeFor(autonomy)
        auth.ts                    # resolveAuth(env) -> HealthStatus
        translate.ts               # SDKMessage -> AgentEvent[]  (the heart)
        input-channel.ts           # push-based AsyncIterable<SDKUserMessage>
        claude-session.ts          # ClaudeSession implements AgentSession
        adapter.ts                 # ClaudeCodeAdapter implements EngineAdapter
        index.ts                   # public exports
      scripts/
        smoke.mts                  # OPTIONAL manual live test (real claude, gated)
      test/
        capabilities.test.ts
        auth.test.ts
        translate.test.ts
        fake-query.ts              # shared scripted fake + SDKMessage builders
        claude-session.test.ts
        adapter.test.ts
        conformance.test.ts        # drives the real Orchestrator
        index.test.ts
```

The adapter never imports VS Code. It depends only on `@maestro/core` interfaces and the Agent SDK.

---

### Task 0: Scaffold `@maestro/adapter-claude` and build core

**Files:**
- Create: `packages/adapter-claude/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (placeholder)

- [ ] **Step 1: Create the package.json**

Create `packages/adapter-claude/package.json`:

```json
{
  "name": "@maestro/adapter-claude",
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
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "@maestro/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

NOTE: the `@anthropic-ai/claude-agent-sdk` version range is a placeholder — on install, accept whatever the latest published version is. If the package name or version differs, report it (do not guess an alternative name).

- [ ] **Step 2: Create tsconfig.json**

Create `packages/adapter-claude/tsconfig.json`:

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

- [ ] **Step 3: Create vitest.config.ts**

Create `packages/adapter-claude/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create the placeholder index**

Create `packages/adapter-claude/src/index.ts`:

```ts
export const MAESTRO_ADAPTER_CLAUDE_VERSION = "0.0.0";
```

- [ ] **Step 5: Install and build core**

The adapter resolves `@maestro/core` through its built `dist/`, so core must be built once.

Run: `pnpm install`
Then: `pnpm --filter @maestro/core build`
Expected: install adds `@anthropic-ai/claude-agent-sdk` under `packages/adapter-claude`; the workspace symlinks `@maestro/core` into it; core's `dist/` is produced. If `@maestro/core build` errors, fix core's build before continuing.

NOTE: if core's source changes later, re-run `pnpm --filter @maestro/core build` so the adapter sees updated types.

- [ ] **Step 6: Verify the toolchain runs**

Run: `cd packages/adapter-claude && pnpm vitest run`
Expected: "No test files found" (exit acceptable) — confirms vitest works.

Run: `cd packages/adapter-claude && pnpm exec tsc --noEmit`
Expected: clean (only the placeholder export exists).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(adapter-claude): scaffold @maestro/adapter-claude package"
```

---

### Task 1: Narrow types, capabilities, permission mode, and auth helpers

**Files:**
- Create: `packages/adapter-claude/src/types.ts`, `src/capabilities.ts`, `src/auth.ts`
- Test: `packages/adapter-claude/test/capabilities.test.ts`, `test/auth.test.ts`

- [ ] **Step 1: Create the narrow SDK type surface**

Create `packages/adapter-claude/src/types.ts`:

```ts
import type {
  CanUseTool,
  Options,
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * The subset of the SDK's `Query` we actually drive. The real `Query`
 * (an AsyncGenerator<SDKMessage> with extra methods) satisfies this structurally.
 */
export interface MaestroQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<void>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
}

/** The shape of the SDK's `query`, narrowed for dependency injection and faking. */
export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => MaestroQuery;

export type { CanUseTool, Options, PermissionResult, SDKMessage, SDKUserMessage };
```

- [ ] **Step 2: Write the failing capabilities test**

Create `packages/adapter-claude/test/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CLAUDE_CAPABILITIES, permissionModeFor } from "../src/capabilities.js";

describe("capabilities", () => {
  it("reports all four capabilities as true", () => {
    expect(CLAUDE_CAPABILITIES).toEqual({
      streaming: true,
      structuredEvents: true,
      approvals: true,
      steerable: true,
    });
  });
});

describe("permissionModeFor", () => {
  it("maps autonomy to the SDK permission mode", () => {
    expect(permissionModeFor("manual")).toBe("default");
    expect(permissionModeFor("auto-approve-safe")).toBe("acceptEdits");
    expect(permissionModeFor("yolo")).toBe("bypassPermissions");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/adapter-claude && pnpm vitest run test/capabilities.test.ts`
Expected: FAIL, cannot find module `../src/capabilities.js`.

- [ ] **Step 4: Implement capabilities.ts**

Create `packages/adapter-claude/src/capabilities.ts`:

```ts
import type { Capabilities, Role } from "@maestro/core";
import type { Options } from "./types.js";

export const CLAUDE_CAPABILITIES: Capabilities = {
  streaming: true,
  structuredEvents: true,
  approvals: true,
  steerable: true,
};

type PermissionMode = NonNullable<Options["permissionMode"]>;

/** Map a role's autonomy policy onto the Agent SDK's permission mode. */
export function permissionModeFor(autonomy: Role["autonomy"]): PermissionMode {
  switch (autonomy) {
    case "yolo":
      return "bypassPermissions";
    case "auto-approve-safe":
      return "acceptEdits";
    case "manual":
      return "default";
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd packages/adapter-claude && pnpm vitest run test/capabilities.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing auth test**

Create `packages/adapter-claude/test/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAuth } from "../src/auth.js";

describe("resolveAuth", () => {
  it("is ok when ANTHROPIC_API_KEY is set", () => {
    expect(resolveAuth({ ANTHROPIC_API_KEY: "sk-x" })).toEqual({ ok: true });
  });

  it("is ok when a cloud provider var is set", () => {
    expect(resolveAuth({ CLAUDE_CODE_USE_BEDROCK: "1" })).toEqual({ ok: true });
  });

  it("is not ok with no credentials, and explains the API-key requirement", () => {
    const status = resolveAuth({});
    expect(status.ok).toBe(false);
    expect(status.detail).toContain("ANTHROPIC_API_KEY");
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd packages/adapter-claude && pnpm vitest run test/auth.test.ts`
Expected: FAIL, cannot find module `../src/auth.js`.

- [ ] **Step 8: Implement auth.ts**

Create `packages/adapter-claude/src/auth.ts`:

```ts
import type { HealthStatus } from "@maestro/core";

const PROVIDER_VARS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

/**
 * Check whether usable Claude Agent SDK credentials are present.
 * The Agent SDK requires API-key (or cloud-provider) auth — claude.ai
 * subscription login is not permitted for third-party products.
 */
export function resolveAuth(env: Record<string, string | undefined>): HealthStatus {
  const found = PROVIDER_VARS.some((v) => env[v]);
  if (found) return { ok: true };
  return {
    ok: false,
    detail:
      "No Claude credentials found. Set ANTHROPIC_API_KEY — the Claude Agent SDK " +
      "requires API-key auth, not a claude.ai subscription.",
  };
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `cd packages/adapter-claude && pnpm vitest run test/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Typecheck and commit**

Run: `cd packages/adapter-claude && pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add packages/adapter-claude/src/types.ts packages/adapter-claude/src/capabilities.ts packages/adapter-claude/src/auth.ts packages/adapter-claude/test/capabilities.test.ts packages/adapter-claude/test/auth.test.ts
git commit -m "feat(adapter-claude): add SDK type surface, capabilities, permission-mode and auth helpers"
```

---

### Task 2: `translate(message)` — SDKMessage to AgentEvent[]

**Files:**
- Create: `packages/adapter-claude/src/translate.ts`
- Test: `packages/adapter-claude/test/fake-query.ts` (shared builders), `test/translate.test.ts`

This is the heart of the adapter: turning the SDK's native messages into the common event stream.

- [ ] **Step 1: Create shared SDKMessage builders + the fake query (used here and later)**

Create `packages/adapter-claude/test/fake-query.ts`:

```ts
import type { CanUseTool, MaestroQuery, QueryFn, SDKMessage } from "../src/types.js";

/** Minimal SDKMessage builders for tests (cast — we only set the fields translate reads). */
export function assistantText(text: string): SDKMessage {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  } as unknown as SDKMessage;
}

export function assistantToolUse(name: string, input: Record<string, unknown>): SDKMessage {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "tu", name, input }] },
  } as unknown as SDKMessage;
}

export function assistantTextAndTool(
  text: string,
  name: string,
  input: Record<string, unknown>,
): SDKMessage {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text },
        { type: "tool_use", id: "tu", name, input },
      ],
    },
  } as unknown as SDKMessage;
}

export function resultSuccess(result: string): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    result,
    is_error: false,
    total_cost_usd: 0.01,
    num_turns: 1,
    session_id: "s1",
  } as unknown as SDKMessage;
}

export function resultError(errors: string[]): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    errors,
    total_cost_usd: 0,
    num_turns: 1,
    session_id: "s1",
  } as unknown as SDKMessage;
}

export function systemInit(): SDKMessage {
  return { type: "system", subtype: "init", session_id: "s1" } as unknown as SDKMessage;
}

/**
 * Build a fake QueryFn. `run` is an async generator factory that receives the
 * `canUseTool` callback the adapter passed in options, so a script can trigger
 * an approval by awaiting it. The returned query records streamed input and
 * whether interrupt() was called, for assertions.
 */
export function makeFakeQuery(run: (canUseTool: CanUseTool) => AsyncGenerator<SDKMessage>): {
  fn: QueryFn;
  interrupted: () => boolean;
  lastQuery: () => MaestroQuery | undefined;
} {
  let interrupted = false;
  let last: MaestroQuery | undefined;
  const fn: QueryFn = ({ options }) => {
    const gen = run(options!.canUseTool!);
    const q: MaestroQuery = {
      [Symbol.asyncIterator]: () => gen,
      interrupt: async () => {
        interrupted = true;
        await gen.return(undefined as never).catch(() => {});
      },
      streamInput: async () => {},
    };
    last = q;
    return q;
  };
  return { fn, interrupted: () => interrupted, lastQuery: () => last };
}
```

- [ ] **Step 2: Write the failing translate test**

Create `packages/adapter-claude/test/translate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { translate } from "../src/translate.js";
import {
  assistantText,
  assistantTextAndTool,
  assistantToolUse,
  resultError,
  resultSuccess,
  systemInit,
} from "./fake-query.js";

describe("translate", () => {
  it("maps assistant text blocks to output events", () => {
    expect(translate(assistantText("hello"))).toEqual([{ kind: "output", text: "hello" }]);
  });

  it("maps tool_use blocks to action events", () => {
    expect(translate(assistantToolUse("Bash", { command: "npm test" }))).toEqual([
      { kind: "action", tool: "Bash", detail: { command: "npm test" } },
    ]);
  });

  it("maps a mixed assistant message to output then action, in order", () => {
    expect(translate(assistantTextAndTool("running tests", "Bash", { command: "npm test" }))).toEqual([
      { kind: "output", text: "running tests" },
      { kind: "action", tool: "Bash", detail: { command: "npm test" } },
    ]);
  });

  it("maps a success result to a done event (no diff)", () => {
    expect(translate(resultSuccess("all green"))).toEqual([
      { kind: "done", summary: "all green" },
    ]);
  });

  it("maps an error result to an error event with the joined errors", () => {
    const events = translate(resultError(["boom", "kaboom"]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error" });
    expect((events[0] as { message: string }).message).toContain("boom; kaboom");
  });

  it("returns no events for a system init message", () => {
    expect(translate(systemInit())).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/adapter-claude && pnpm vitest run test/translate.test.ts`
Expected: FAIL, cannot find module `../src/translate.js`.

- [ ] **Step 4: Implement translate.ts**

Create `packages/adapter-claude/src/translate.ts`:

```ts
import type { AgentEvent } from "@maestro/core";
import type { SDKMessage } from "./types.js";

/** Translate one SDK message into zero or more common AgentEvents. */
export function translate(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case "assistant": {
      const events: AgentEvent[] = [];
      for (const block of message.message.content) {
        if (block.type === "text") {
          events.push({ kind: "output", text: block.text });
        } else if (block.type === "tool_use") {
          events.push({ kind: "action", tool: block.name, detail: block.input });
        }
      }
      return events;
    }
    case "result": {
      if (message.subtype === "success") {
        return [{ kind: "done", summary: message.result }];
      }
      const detail =
        "errors" in message && message.errors.length > 0
          ? message.errors.join("; ")
          : message.subtype;
      return [{ kind: "error", message: `Claude run failed: ${detail}` }];
    }
    default:
      return [];
  }
}
```

NOTE: `message.message.content` is typed as Anthropic content blocks; narrowing on `block.type` gives access to `text` / `name` / `input`. If `tsc` complains that `content` may be a `string`, narrow with `Array.isArray(message.message.content)` first and return `[]` otherwise (string content is not produced by the assistant variant in practice, but the guard keeps the types honest).

- [ ] **Step 5: Run it to verify it passes**

Run: `cd packages/adapter-claude && pnpm vitest run test/translate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `cd packages/adapter-claude && pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add packages/adapter-claude/src/translate.ts packages/adapter-claude/test/fake-query.ts packages/adapter-claude/test/translate.test.ts
git commit -m "feat(adapter-claude): translate SDK messages into common AgentEvents"
```

---

### Task 3: `InputChannel` and `ClaudeSession`

**Files:**
- Create: `packages/adapter-claude/src/input-channel.ts`, `src/claude-session.ts`
- Test: `packages/adapter-claude/test/claude-session.test.ts`

- [ ] **Step 1: Implement the input channel**

Create `packages/adapter-claude/src/input-channel.ts`:

```ts
import type { SDKUserMessage } from "./types.js";

/** A push-based AsyncIterable of SDK user messages — the streaming-input channel. */
export class InputChannel implements AsyncIterable<SDKUserMessage> {
  private readonly buffer: SDKUserMessage[] = [];
  private resolver: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private ended = false;

  push(text: string): void {
    if (this.ended) return;
    const msg = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    } as unknown as SDKUserMessage;
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      resolve({ value: msg, done: false });
    } else {
      this.buffer.push(msg);
    }
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      resolve({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => {
          this.resolver = resolve;
        });
      },
    };
  }
}
```

- [ ] **Step 2: Write the failing session test**

Create `packages/adapter-claude/test/claude-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@maestro/core";
import type { Options } from "../src/types.js";
import { ClaudeSession } from "../src/claude-session.js";
import { assistantText, makeFakeQuery, resultError, resultSuccess } from "./fake-query.js";

const baseOptions: Options = { model: "claude-opus-4-8" };

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("ClaudeSession", () => {
  it("streams output then done on a successful run", async () => {
    const fake = makeFakeQuery(async function* () {
      yield assistantText("writing code");
      yield resultSuccess("added rate limiting");
    });
    const session = new ClaudeSession(fake.fn, baseOptions, "add rate limiting");
    session.start();

    expect(await collect(session.events)).toEqual([
      { kind: "output", text: "writing code" },
      { kind: "done", summary: "added rate limiting" },
    ]);
    expect(fake.interrupted()).toBe(true); // session interrupts after the result
  });

  it("emits an error event on an error result", async () => {
    const fake = makeFakeQuery(async function* () {
      yield resultError(["compilation failed"]);
    });
    const session = new ClaudeSession(fake.fn, baseOptions, "task");
    const events = await collect(session.events.start ? session.events : session.events);
    session.start();
    // start() must be called before collecting; re-run cleanly:
  });

  it("parks on an approval, then resumes and completes when approved", async () => {
    const fake = makeFakeQuery(async function* (canUseTool) {
      const decision = await canUseTool(
        "Bash",
        { command: "npm test" },
        { signal: new AbortController().signal, toolUseID: "tu_1" } as never,
      );
      if (decision.behavior === "allow") {
        yield resultSuccess("done");
      } else {
        yield resultError(["denied"]);
      }
    });
    const session = new ClaudeSession(fake.fn, baseOptions, "task");
    session.start();

    const iterator = session.events[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toEqual({
      kind: "approval",
      id: "tu_1",
      detail: { tool: "Bash", input: { command: "npm test" } },
    });

    session.respond("tu_1", "allow");
    const second = await iterator.next();
    expect(second.value).toEqual({ kind: "done", summary: "done" });
  });

  it("records steered input via send()", async () => {
    const fake = makeFakeQuery(async function* () {
      yield assistantText("ack");
      yield resultSuccess("done");
    });
    const session = new ClaudeSession(fake.fn, baseOptions, "task");
    session.start();
    session.send("focus on edge cases"); // must not throw
    await collect(session.events);
    expect(true).toBe(true);
  });

  it("stop() interrupts and ends the stream", async () => {
    // A run that never completes on its own until interrupted.
    const fake = makeFakeQuery(async function* (canUseTool) {
      await canUseTool("Bash", {}, { signal: new AbortController().signal, toolUseID: "tu_x" } as never);
      yield resultSuccess("unreachable");
    });
    const session = new ClaudeSession(fake.fn, baseOptions, "task");
    session.start();
    const iterator = session.events[Symbol.asyncIterator]();
    await iterator.next(); // the approval event
    session.stop();
    const ended = await iterator.next();
    expect(ended.done).toBe(true);
    expect(fake.interrupted()).toBe(true);
  });
});
```

NOTE: the second test above is intentionally a stub placeholder — replace its body before running with the clean version below. (Kept here only to show the shape; Step 4 fixes it.)

- [ ] **Step 3: Fix the error-result test (replace the stub)**

Replace the `it("emits an error event on an error result", ...)` block in `test/claude-session.test.ts` with:

```ts
  it("emits an error event on an error result", async () => {
    const fake = makeFakeQuery(async function* () {
      yield resultError(["compilation failed"]);
    });
    const session = new ClaudeSession(fake.fn, baseOptions, "task");
    session.start();
    const events = await collect(session.events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error" });
    expect((events[0] as { message: string }).message).toContain("compilation failed");
  });
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd packages/adapter-claude && pnpm vitest run test/claude-session.test.ts`
Expected: FAIL, cannot find module `../src/claude-session.js`.

- [ ] **Step 5: Implement claude-session.ts**

Create `packages/adapter-claude/src/claude-session.ts`:

```ts
import type { AgentEvent, AgentSession, ApprovalDecision } from "@maestro/core";
import { EventQueue } from "@maestro/core";
import { InputChannel } from "./input-channel.js";
import { translate } from "./translate.js";
import type { MaestroQuery, Options, PermissionResult, QueryFn } from "./types.js";

export class ClaudeSession implements AgentSession {
  private readonly queue = new EventQueue();
  private readonly input = new InputChannel();
  private readonly approvals = new Map<string, (result: PermissionResult) => void>();
  private query?: MaestroQuery;
  private stopped = false;

  constructor(
    private readonly queryFn: QueryFn,
    private readonly baseOptions: Options,
    private readonly task: string,
  ) {}

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  /** Begin the run. Call once, immediately after construction. */
  start(): void {
    const options: Options = {
      ...this.baseOptions,
      canUseTool: (toolName, input, callbackOptions) =>
        this.onApproval(toolName, input, callbackOptions.toolUseID),
    };
    this.query = this.queryFn({ prompt: this.input, options });
    this.input.push(this.task);
    void this.run();
  }

  private onApproval(
    tool: string,
    input: Record<string, unknown>,
    id: string,
  ): Promise<PermissionResult> {
    this.queue.push({ kind: "approval", id, detail: { tool, input } });
    return new Promise<PermissionResult>((resolve) => {
      this.approvals.set(id, resolve);
    });
  }

  private async run(): Promise<void> {
    try {
      for await (const message of this.query!) {
        if (this.stopped) break;
        for (const event of translate(message)) {
          this.queue.push(event);
          if (event.kind === "done" || event.kind === "error") {
            await this.terminate();
            return;
          }
        }
      }
      if (!this.stopped) {
        this.queue.push({ kind: "error", message: "Claude stream ended without a result" });
      }
    } catch (error) {
      if (!this.stopped) {
        const message = error instanceof Error ? error.message : String(error);
        this.queue.push({ kind: "error", message: `Claude session error: ${message}` });
      }
    } finally {
      this.input.end();
      this.queue.end();
    }
  }

  /** End the streaming-input session after a terminal event. */
  private async terminate(): Promise<void> {
    this.input.end();
    try {
      await this.query?.interrupt();
    } catch {
      /* already ending */
    }
    this.queue.end();
  }

  send(input: string): void {
    this.input.push(input);
  }

  respond(approvalId: string, decision: ApprovalDecision): void {
    const resolve = this.approvals.get(approvalId);
    if (!resolve) return;
    this.approvals.delete(approvalId);
    resolve(
      decision === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "Denied by the conductor" },
    );
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const resolve of this.approvals.values()) {
      resolve({ behavior: "deny", message: "Stopped by the conductor" });
    }
    this.approvals.clear();
    this.input.end();
    void this.query?.interrupt().catch(() => {});
    this.queue.end();
  }
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `cd packages/adapter-claude && pnpm vitest run test/claude-session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck and commit**

Run: `cd packages/adapter-claude && pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add packages/adapter-claude/src/input-channel.ts packages/adapter-claude/src/claude-session.ts packages/adapter-claude/test/claude-session.test.ts
git commit -m "feat(adapter-claude): add ClaudeSession with approval bridge and steering"
```

---

### Task 4: `ClaudeCodeAdapter`

**Files:**
- Create: `packages/adapter-claude/src/adapter.ts`
- Test: `packages/adapter-claude/test/adapter.test.ts`

- [ ] **Step 1: Write the failing adapter test**

Create `packages/adapter-claude/test/adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent, Role, Task, Workspace } from "@maestro/core";
import type { Options } from "../src/types.js";
import { ClaudeCodeAdapter } from "../src/adapter.js";
import { assistantText, makeFakeQuery, resultSuccess } from "./fake-query.js";

const role: Role = {
  name: "Implementer",
  instructions: "Write clean, tested code.",
  engine: { id: "claude-code", model: "claude-opus-4-8" },
  autonomy: "manual",
};
const task: Task = { id: "t1", description: "add caching", roleName: "Implementer" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/wt/a1", branch: "agent/a1" };

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("ClaudeCodeAdapter", () => {
  it("exposes id and capabilities", () => {
    const adapter = new ClaudeCodeAdapter({ query: makeFakeQuery(async function* () {}).fn });
    expect(adapter.id).toBe("claude-code");
    expect(adapter.capabilities).toEqual({
      streaming: true,
      structuredEvents: true,
      approvals: true,
      steerable: true,
    });
  });

  it("health reflects the injected env", async () => {
    const ok = new ClaudeCodeAdapter({ env: { ANTHROPIC_API_KEY: "sk-x" } });
    expect(await ok.health()).toEqual({ ok: true });
    const bad = new ClaudeCodeAdapter({ env: {} });
    expect((await bad.health()).ok).toBe(false);
  });

  it("builds SDK options from the role and workspace, and runs to done", async () => {
    let captured: Options | undefined;
    const fakeFactory = makeFakeQuery(async function* () {
      yield assistantText("ok");
      yield resultSuccess("cached");
    });
    // wrap the fake to capture the options the adapter passed
    const capturingQuery: typeof fakeFactory.fn = (params) => {
      captured = params.options;
      return fakeFactory.fn(params);
    };

    const adapter = new ClaudeCodeAdapter({ query: capturingQuery });
    const session = adapter.start(task, workspace, role);

    const events = await collect(session.events);
    expect(events).toEqual([
      { kind: "output", text: "ok" },
      { kind: "done", summary: "cached" },
    ]);

    expect(captured?.model).toBe("claude-opus-4-8");
    expect(captured?.cwd).toBe("/tmp/wt/a1");
    expect(captured?.permissionMode).toBe("default");
    expect(captured?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Write clean, tested code.",
    });
    expect(typeof captured?.canUseTool).toBe("function");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/adapter-claude && pnpm vitest run test/adapter.test.ts`
Expected: FAIL, cannot find module `../src/adapter.js`.

- [ ] **Step 3: Implement adapter.ts**

Create `packages/adapter-claude/src/adapter.ts`:

```ts
import { query as realQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentSession,
  EngineAdapter,
  HealthStatus,
  Role,
  Task,
  Workspace,
} from "@maestro/core";
import { resolveAuth } from "./auth.js";
import { CLAUDE_CAPABILITIES, permissionModeFor } from "./capabilities.js";
import { ClaudeSession } from "./claude-session.js";
import type { Options, QueryFn } from "./types.js";

export interface ClaudeCodeAdapterOptions {
  /** Injectable for testing; defaults to the real Agent SDK `query`. */
  query?: QueryFn;
  /** Injectable for testing; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

export class ClaudeCodeAdapter implements EngineAdapter {
  readonly id = "claude-code";
  readonly capabilities = CLAUDE_CAPABILITIES;
  private readonly queryFn: QueryFn;
  private readonly env: Record<string, string | undefined>;

  constructor(opts: ClaudeCodeAdapterOptions = {}) {
    // The real `query` is only invoked when no fake is injected; the cast bridges
    // the SDK's wide `Query`/prompt types to our narrow QueryFn at the boundary.
    this.queryFn = opts.query ?? (realQuery as unknown as QueryFn);
    this.env = opts.env ?? process.env;
  }

  health(): Promise<HealthStatus> {
    return Promise.resolve(resolveAuth(this.env));
  }

  start(task: Task, workspace: Workspace, role: Role): AgentSession {
    const options: Options = {
      model: role.engine.model,
      cwd: workspace.path,
      permissionMode: permissionModeFor(role.autonomy),
      systemPrompt: { type: "preset", preset: "claude_code", append: role.instructions },
      includePartialMessages: false,
    };
    const session = new ClaudeSession(this.queryFn, options, task.description);
    session.start();
    return session;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/adapter-claude && pnpm vitest run test/adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `cd packages/adapter-claude && pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add packages/adapter-claude/src/adapter.ts packages/adapter-claude/test/adapter.test.ts
git commit -m "feat(adapter-claude): add ClaudeCodeAdapter implementing EngineAdapter"
```

---

### Task 5: Conformance — drive the real Orchestrator

**Files:**
- Test: `packages/adapter-claude/test/conformance.test.ts`

This proves the milestone's purpose: a real adapter satisfies the contract the `Orchestrator` expects, including the approval round-trip, with no source changes.

- [ ] **Step 1: Write the conformance test**

Create `packages/adapter-claude/test/conformance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeWorkspaceProvider, Orchestrator } from "@maestro/core";
import type { Role } from "@maestro/core";
import { ClaudeCodeAdapter } from "../src/adapter.js";
import { assistantText, makeFakeQuery, resultSuccess } from "./fake-query.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "claude-code", model: "claude-opus-4-8" },
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

describe("ClaudeCodeAdapter conformance via Orchestrator", () => {
  it("spawns, runs, and reaches done through the orchestrator", async () => {
    const fake = makeFakeQuery(async function* () {
      yield assistantText("implementing");
      yield resultSuccess("feature added");
    });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new ClaudeCodeAdapter({ query: fake.fn }));

    const agent = orch.spawn("Implementer", "add a feature");
    await waitForState(orch, agent.id, "done");

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.summary).toBe("feature added");
    expect(final.log.map((e) => e.kind)).toEqual(["output", "done"]);
  });

  it("parks at awaiting-approval and completes when the conductor approves", async () => {
    const fake = makeFakeQuery(async function* (canUseTool) {
      const decision = await canUseTool(
        "Bash",
        { command: "npm test" },
        { signal: new AbortController().signal, toolUseID: "tu_1" } as never,
      );
      if (decision.behavior === "allow") yield resultSuccess("done");
      else yield resultSuccess("denied path");
    });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new ClaudeCodeAdapter({ query: fake.fn }));

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "awaiting-approval");
    expect(orch.getAgent(agent.id)!.pendingApprovalId).toBe("tu_1");

    orch.approve(agent.id, "tu_1", "allow");
    await waitForState(orch, agent.id, "done");
    expect(orch.getAgent(agent.id)!.summary).toBe("done");
  });
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `cd packages/adapter-claude && pnpm vitest run test/conformance.test.ts`
Expected: PASS (2 tests). If the approval test hangs, the `canUseTool` `toolUseID` is not being surfaced as the approval id — check `ClaudeSession.onApproval` uses `callbackOptions.toolUseID`.

- [ ] **Step 3: Commit**

```bash
git add packages/adapter-claude/test/conformance.test.ts
git commit -m "test(adapter-claude): conformance through the real Orchestrator (run + approval)"
```

---

### Task 6: Public exports, optional live smoke test, README, and full gate

**Files:**
- Modify: `packages/adapter-claude/src/index.ts`
- Create: `packages/adapter-claude/scripts/smoke.mts`, `packages/adapter-claude/README.md`
- Test: `packages/adapter-claude/test/index.test.ts`

- [ ] **Step 1: Write the failing index test**

Create `packages/adapter-claude/test/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as adapter from "../src/index.js";

describe("public API", () => {
  it("exports the adapter and translate", () => {
    expect(typeof adapter.ClaudeCodeAdapter).toBe("function");
    expect(typeof adapter.translate).toBe("function");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/adapter-claude && pnpm vitest run test/index.test.ts`
Expected: FAIL (exports undefined).

- [ ] **Step 3: Update the public exports**

Replace `packages/adapter-claude/src/index.ts` with:

```ts
export const MAESTRO_ADAPTER_CLAUDE_VERSION = "0.0.0";

export { ClaudeCodeAdapter } from "./adapter.js";
export type { ClaudeCodeAdapterOptions } from "./adapter.js";
export { translate } from "./translate.js";
export { CLAUDE_CAPABILITIES, permissionModeFor } from "./capabilities.js";
export { resolveAuth } from "./auth.js";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/adapter-claude && pnpm vitest run test/index.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Create the optional live smoke test**

Create `packages/adapter-claude/scripts/smoke.mts`. This is a MANUAL, OPTIONAL check — it is not part of the vitest gate. It runs the real adapter against the real `claude` on a throwaway task, and requires `ANTHROPIC_API_KEY` plus `MAESTRO_LIVE=1`. It imports the built package, so run `pnpm --filter @maestro/adapter-claude build` first.

```ts
// Run: MAESTRO_LIVE=1 ANTHROPIC_API_KEY=sk-... pnpm --filter @maestro/adapter-claude smoke
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter } from "../dist/index.js";

if (process.env.MAESTRO_LIVE !== "1" || !process.env.ANTHROPIC_API_KEY) {
  console.log("Skipping live smoke test (set MAESTRO_LIVE=1 and ANTHROPIC_API_KEY to run).");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "maestro-smoke-"));
writeFileSync(join(dir, "README.md"), "# Smoke\n");

const adapter = new ClaudeCodeAdapter();
const health = await adapter.health();
console.log("health:", health);
if (!health.ok) process.exit(1);

const session = adapter.start(
  { id: "t", description: "Add a single line 'Hello from Maestro' to README.md", roleName: "R" },
  { agentId: "a", path: dir, branch: "smoke" },
  {
    name: "R",
    instructions: "Make the smallest possible change. Do not run shell commands.",
    engine: { id: "claude-code", model: "claude-opus-4-8" },
    autonomy: "yolo",
  },
);

for await (const event of session.events) {
  console.log(event.kind, "kind" in event ? "" : "", JSON.stringify(event).slice(0, 200));
}
console.log("Smoke complete. Inspect:", dir);
```

NOTE: `autonomy: "yolo"` (bypassPermissions) is used so the smoke test runs unattended in an isolated temp dir. This is the step that validates the real streaming-input → result → interrupt termination path that the unit tests model with the fake. If `claude` is not installed or not authed, `health()` will report it; if the run hangs after `done`, revisit `ClaudeSession.terminate()`.

- [ ] **Step 6: Create the README**

Create `packages/adapter-claude/README.md`:

```markdown
# @maestro/adapter-claude

The Claude Code engine adapter for Maestro. Implements `EngineAdapter` from
`@maestro/core` by driving Claude Code through the official Agent SDK
(`@anthropic-ai/claude-agent-sdk`).

## Auth

The Agent SDK requires **API-key** auth: set `ANTHROPIC_API_KEY` (or a cloud
provider variable: `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_ANTHROPIC_AWS` /
`_FOUNDRY`). Anthropic's terms do **not** permit third-party products to reuse a
claude.ai subscription login for the Agent SDK, so unlike the Codex/Gemini/Copilot
CLI adapters, this adapter cannot piggyback a Claude subscription.

## Autonomy mapping

| Role autonomy        | SDK permission mode  |
| -------------------- | -------------------- |
| `manual`             | `default` (intercepts each tool via `canUseTool`) |
| `auto-approve-safe`  | `acceptEdits`        |
| `yolo`               | `bypassPermissions`  |

## Testing

`pnpm --filter @maestro/adapter-claude test` runs the full suite with a fake
`query` — no SDK process, no network, no API key. The optional live smoke test
(`pnpm --filter @maestro/adapter-claude build && MAESTRO_LIVE=1 ANTHROPIC_API_KEY=... pnpm --filter @maestro/adapter-claude smoke`)
exercises the real `claude`.
```

- [ ] **Step 7: Full milestone gate**

Run: `cd packages/adapter-claude && pnpm vitest run && pnpm exec tsc --noEmit`
Expected: ALL tests pass (capabilities 2, auth 3, translate 6, claude-session 5, adapter 3, conformance 2, index 1 = 22 across 7 files), typecheck clean.

Also confirm core still passes (unchanged): `cd ../core && pnpm vitest run` (35 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-claude/src/index.ts packages/adapter-claude/test/index.test.ts packages/adapter-claude/scripts/smoke.mts packages/adapter-claude/README.md
git commit -m "feat(adapter-claude): public API, live smoke script, README; pass full milestone gate"
```

---

## Definition of done (Milestone 2)

- `pnpm --filter @maestro/adapter-claude test` green (22 tests), `typecheck` clean.
- `ClaudeCodeAdapter` implements `EngineAdapter` and drives Claude Code via the Agent SDK: typed event translation, `canUseTool` approval round-trip, steering, stop, and a terminal `result` → `done`.
- Validated end-to-end through the real `Orchestrator` (run + approval), entirely offline.
- An optional, gated live smoke test exists to validate the real `claude` wiring on demand.

## Risks and verification notes

- **Streaming-input termination.** Unit tests model "result → interrupt → end" with the fake; the live smoke test (Task 6) is what confirms the real SDK ends cleanly after `interrupt()`. Run it once before relying on the adapter.
- **SDK content-block typing.** If `tsc` rejects `message.message.content` indexing (string-vs-blocks union), add the `Array.isArray` guard noted in Task 2 Step 4.
- **SDK package version.** The plan pins `@anthropic-ai/claude-agent-sdk ^0.1.0` as a placeholder; accept the latest on install and report the real version.
- **Auth correction.** Update the design doc's "Auth and cost notes": Claude subscription reuse does NOT hold for the Agent SDK (API key required). The Codex/Gemini/Copilot CLI adapters still reuse their own logins.

## What this unlocks (next milestones)

- **Milestone 3:** Workspace Manager (real `git worktree` create/merge/conflict + `cleanup` wiring on terminal transitions) replacing `FakeWorkspaceProvider`; derive the `done.diff` from the worktree; plus the formal adapter conformance suite every adapter must pass (the Claude and Fake adapters are the first two members).
- **Milestone 4:** VS Code extension shell + webview cockpit rendering `OrchestratorEvent`s.
- **Milestone 5:** the generic ACP adapter (Gemini + Copilot).

## Self-review notes

- **Spec coverage:** implements build-order step 2 (real Claude adapter via Agent SDK), proving the M1 contract against a real engine, with approval interception (the highest-risk capability) covered by `canUseTool`. Real diff, worktrees, health-gating, and the UI remain deferred (M3/M4) and are listed above.
- **Type consistency:** `QueryFn` / `MaestroQuery` / `Options` / `PermissionResult` / `SDKMessage` are defined once in `types.ts` and reused verbatim; `translate` returns the same `AgentEvent` shape `@maestro/core` defines; the adapter's `start(task, workspace, role)` matches the M2-refined contract.
- **No placeholders:** every code step has complete, runnable code; the one intentional stub in Task 3 Step 2 is explicitly replaced in Step 3 before any run command.

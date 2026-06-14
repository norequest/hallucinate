import { describe, it, expect } from "vitest";
import type { OrchestratorEvent, Agent } from "@maestro/core";
import {
  serializeEvent,
  deserializeEvent,
  replayToRecords,
  MemoryPersistenceBackend,
  EventLogger,
} from "../src/persistence.js";

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    task: { id: "t1", description: "fix it", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "do the thing", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state: "working",
    log: [],
    ...over,
  };
}

describe("serializeEvent / deserializeEvent round-trip", () => {
  it("round-trips agent-added", () => {
    const event: OrchestratorEvent = { kind: "agent-added", agent: agent() };
    const line = serializeEvent(event);
    expect(line.endsWith("\n")).toBe(true);
    expect(deserializeEvent(line.trim())).toEqual(event);
  });

  it("round-trips agent-event with output", () => {
    const event: OrchestratorEvent = { kind: "agent-event", agentId: "a1", event: { kind: "output", text: "hello world" } };
    expect(deserializeEvent(serializeEvent(event).trim())).toEqual(event);
  });

  it("round-trips agent-updated with summary and diff", () => {
    const event: OrchestratorEvent = {
      kind: "agent-updated",
      agent: agent({ state: "done", summary: "patched 3 tests", diff: { files: ["src/foo.ts"], patch: "- old\n+ new" } }),
    };
    expect(deserializeEvent(serializeEvent(event).trim())).toEqual(event);
  });

  it("returns null for malformed JSON", () => {
    expect(deserializeEvent("not json")).toBeNull();
  });

  it("returns null for a JSON object with no kind field", () => {
    expect(deserializeEvent('{"foo":1}')).toBeNull();
  });
});

describe("replayToRecords", () => {
  it("extracts the last known Agent snapshot per agent id", () => {
    const events: OrchestratorEvent[] = [
      { kind: "agent-added", agent: agent({ state: "preparing" }) },
      { kind: "agent-updated", agent: agent({ state: "working" }) },
      { kind: "agent-event", agentId: "a1", event: { kind: "output", text: "hi" } },
      { kind: "agent-updated", agent: agent({ state: "done", summary: "done" }) },
    ];
    const records = replayToRecords(events);
    expect(records).toHaveLength(1);
    expect(records[0]!.agent.state).toBe("done");
    expect(records[0]!.agent.summary).toBe("done");
  });

  it("carries workspacePath/workspaceBranch from the agent snapshot", () => {
    const events: OrchestratorEvent[] = [
      { kind: "agent-added", agent: agent({ state: "done", workspace: { agentId: "a1", path: "/wt/a1", branch: "agent/a1" } }) },
    ];
    const records = replayToRecords(events);
    expect(records[0]!.workspacePath).toBe("/wt/a1");
    expect(records[0]!.workspaceBranch).toBe("agent/a1");
  });

  it("handles multiple agents", () => {
    const events: OrchestratorEvent[] = [
      { kind: "agent-added", agent: agent({ id: "a1" }) },
      { kind: "agent-added", agent: agent({ id: "a2" }) },
    ];
    expect(replayToRecords(events).map((r) => r.agent.id).sort()).toEqual(["a1", "a2"]);
  });

  it("returns empty array for empty event list", () => {
    expect(replayToRecords([])).toEqual([]);
  });
});

describe("MemoryPersistenceBackend", () => {
  it("appends and reads lines", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", "line1\n");
    await backend.append("a1", "line2\n");
    expect(await backend.read("a1")).toBe("line1\nline2\n");
  });

  it("lists agent ids", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", "x\n");
    await backend.append("a2", "y\n");
    expect((await backend.listAgentIds()).sort()).toEqual(["a1", "a2"]);
  });

  it("returns empty string for an unknown agent", async () => {
    expect(await new MemoryPersistenceBackend().read("missing")).toBe("");
  });

  it("remove deletes the agent log", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", "x\n");
    await backend.remove("a1");
    expect(await backend.listAgentIds()).toEqual([]);
  });
});

describe("EventLogger", () => {
  it("appends serialized events to the backend, routed by agent id", async () => {
    const backend = new MemoryPersistenceBackend();
    const logger = new EventLogger(backend);
    const event: OrchestratorEvent = { kind: "agent-added", agent: agent({ state: "preparing" }) };
    logger.write(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(deserializeEvent((await backend.read("a1")).trim())).toEqual(event);
  });

  it("routes agent-event to the right agent log", async () => {
    const backend = new MemoryPersistenceBackend();
    const logger = new EventLogger(backend);
    logger.write({ kind: "agent-added", agent: agent({ id: "a2" }) });
    logger.write({ kind: "agent-event", agentId: "a2", event: { kind: "output", text: "hi" } });
    await new Promise((r) => setTimeout(r, 0));
    expect((await backend.read("a2")).trim().split("\n")).toHaveLength(2);
  });

  it("loadAll replays all agents and returns PersistedAgentRecord[]", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", serializeEvent({ kind: "agent-added", agent: agent({ state: "working" }) }));
    await backend.append("a1", serializeEvent({ kind: "agent-updated", agent: agent({ state: "done", summary: "done" }) }));
    const records = await new EventLogger(backend).loadAll();
    expect(records).toHaveLength(1);
    expect(records[0]!.agent.state).toBe("done");
  });

  it("forget removes the agent log", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", "x\n");
    await new EventLogger(backend).forget("a1");
    expect(await backend.listAgentIds()).toEqual([]);
  });
});

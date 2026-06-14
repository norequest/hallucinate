import type { Agent, OrchestratorEvent, PersistedAgentRecord } from "@maestro/core";

// Section A: Codec ----------------------------------------------------------

/** Serialize one OrchestratorEvent to a JSONL line (JSON + newline). Pure. */
export function serializeEvent(event: OrchestratorEvent): string {
  return JSON.stringify(event) + "\n";
}

/**
 * Parse a JSONL line back to an OrchestratorEvent. Returns null for malformed
 * JSON or objects without a string `kind`. Pure, no I/O.
 */
export function deserializeEvent(line: string): OrchestratorEvent | null {
  try {
    const obj: unknown = JSON.parse(line);
    if (
      obj === null ||
      typeof obj !== "object" ||
      !("kind" in obj) ||
      typeof (obj as { kind: unknown }).kind !== "string"
    ) {
      return null;
    }
    // The only writer is serializeEvent, which writes typed events. A schema
    // validator can be layered in here in a future hardening milestone.
    return obj as OrchestratorEvent;
  } catch {
    return null;
  }
}

// Section B: Replay ---------------------------------------------------------

/**
 * Fold OrchestratorEvents into one PersistedAgentRecord per unique agent id.
 * The record's agent is the last agent-added/agent-updated snapshot for that id.
 * Pure.
 */
export function replayToRecords(events: readonly OrchestratorEvent[]): PersistedAgentRecord[] {
  const latest = new Map<string, Agent>();
  for (const event of events) {
    if (event.kind === "agent-added" || event.kind === "agent-updated") {
      latest.set(event.agent.id, event.agent);
    }
    // agent-event carries no snapshot; the snapshot's own log holds the history.
  }
  return [...latest.values()].map((agent) => ({
    agent,
    workspacePath: agent.workspace?.path,
    workspaceBranch: agent.workspace?.branch,
  }));
}

// Section C: Store abstraction ---------------------------------------------

/**
 * Persistence backend seam. The pure logic above does not know about files or
 * VS Code. Implementations: MemoryPersistenceBackend (tests),
 * FsPersistenceBackend (production, in persistence-fs.ts).
 */
export interface PersistenceBackend {
  /** Full content of one agent's JSONL log; "" if none. */
  read(agentId: string): Promise<string>;
  /** Append one already-serialized line (with trailing newline). */
  append(agentId: string, line: string): Promise<void>;
  /** All agent ids with a persisted log. */
  listAgentIds(): Promise<string[]>;
  /** Delete an agent's log (on merge or discard). */
  remove(agentId: string): Promise<void>;
}

/** In-memory backend for unit tests. No real fs. */
export class MemoryPersistenceBackend implements PersistenceBackend {
  private readonly store = new Map<string, string>();
  read(agentId: string): Promise<string> {
    return Promise.resolve(this.store.get(agentId) ?? "");
  }
  append(agentId: string, line: string): Promise<void> {
    this.store.set(agentId, (this.store.get(agentId) ?? "") + line);
    return Promise.resolve();
  }
  listAgentIds(): Promise<string[]> {
    return Promise.resolve([...this.store.keys()]);
  }
  remove(agentId: string): Promise<void> {
    this.store.delete(agentId);
    return Promise.resolve();
  }
}

/**
 * Routes OrchestratorEvents to the correct agent log and loads them back.
 *
 *   const logger = new EventLogger(backend);
 *   const records = await logger.loadAll();   // before subscribing
 *   orch.hydrate(records);
 *   const unsub = orch.on((e) => logger.write(e));
 */
export class EventLogger {
  constructor(private readonly backend: PersistenceBackend) {}

  /** Persist one event (fire-and-forget; errors are logged, never thrown). */
  write(event: OrchestratorEvent): void {
    const agentId = agentIdOf(event);
    if (agentId === null) return;
    this.backend.append(agentId, serializeEvent(event)).catch((err: unknown) => {
      console.error(`[Maestro persistence] failed to persist event for ${agentId}:`, err);
    });
  }

  /** Read all agent logs and return hydration records. Call once on activate. */
  async loadAll(): Promise<PersistedAgentRecord[]> {
    const ids = await this.backend.listAgentIds();
    const all: OrchestratorEvent[] = [];
    for (const id of ids) {
      const content = await this.backend.read(id);
      for (const line of content.split("\n")) {
        if (line.length === 0) continue;
        const event = deserializeEvent(line);
        if (event !== null) all.push(event);
      }
    }
    return replayToRecords(all);
  }

  /** Remove a resolved agent's log (after merge or discard). */
  forget(agentId: string): Promise<void> {
    return this.backend.remove(agentId);
  }
}

function agentIdOf(event: OrchestratorEvent): string | null {
  switch (event.kind) {
    case "agent-added":
      return event.agent.id;
    case "agent-updated":
      return event.agent.id;
    case "agent-event":
      return event.agentId;
  }
}

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

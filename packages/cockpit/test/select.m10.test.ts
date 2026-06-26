import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, OrchestratorEvent } from "@hallucinate/core";
import { initialModel, reduce } from "../src/reducer.js";
import { selectAttention, selectState } from "../src/select.js";

function agent(id: string, state: Agent["state"], over: Partial<Agent> = {}): Agent {
  return {
    id,
    task: { id: `t-${id}`, description: "x", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state,
    log: [],
    ...over,
  };
}
const added = (a: Agent): OrchestratorEvent => ({ kind: "agent-added", agent: a });

describe("selectAttention (M10 attention queue)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("orders conflict before awaiting-approval (most-urgent first)", () => {
    vi.setSystemTime(1_000);
    let m = initialModel();
    m = reduce(m, added(agent("a1", "awaiting-approval")));
    m = reduce(m, added(agent("a2", "conflict")));

    const att = selectAttention(m);
    expect(att.map((a) => a.id)).toEqual(["a2", "a1"]);
    // Each entry carries the renderable fields the bar needs.
    const conflict = att[0]!;
    expect(conflict.kind).toBe("conflict");
    expect(conflict.state).toBe("conflict");
    expect(conflict.roleName).toBe("Implementer");
    expect(conflict.since).toBe(1_000);
  });

  it("tie-breaks same-kind cards by oldest needsYouSince first (since beats id)", () => {
    // "zebra" enters attention first (older `since`); "apple" enters later.
    // Alphabetical id order would put "apple" first, so a since-first result
    // proves `since` dominates the id tie-break.
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent("zebra", "awaiting-approval")));
    vi.setSystemTime(2_000);
    m = reduce(m, added(agent("apple", "awaiting-approval")));

    const att = selectAttention(m);
    expect(att.map((a) => a.id)).toEqual(["zebra", "apple"]);
    expect(att.map((a) => a.since)).toEqual([1_000, 2_000]);
  });

  it("returns [] when nothing needs attention, and selectState.attention reflects it", () => {
    const m = reduce(initialModel(), added(agent("a1", "working")));
    expect(selectAttention(m)).toEqual([]);
    expect(selectState(m).attention).toEqual([]);
  });

  it("maps each attention state to the right kind", () => {
    const cases: ReadonlyArray<[Agent["state"], string]> = [
      ["awaiting-approval", "approval"],
      ["conflict", "conflict"],
      ["done", "review"],
      ["error", "error"],
      ["detached", "detached"],
      ["merge-cleanup-failed", "cleanup"],
    ];
    for (const [state, kind] of cases) {
      const m = reduce(initialModel(), added(agent("a1", state)));
      const att = selectAttention(m);
      expect(att).toHaveLength(1);
      expect(att[0]!.kind).toBe(kind);
      expect(att[0]!.state).toBe(state);
    }
  });

  it("carries the pending approval id and detail for an approval entry", () => {
    const m = reduce(
      initialModel(),
      added(
        agent("a1", "awaiting-approval", {
          pendingApprovalId: "ap-7",
          approvalDetail: { tool: "Run", description: "rm -rf build" },
        }),
      ),
    );
    const att = selectAttention(m);
    expect(att[0]!.pendingApprovalId).toBe("ap-7");
    expect(att[0]!.approvalDetail).toEqual({ tool: "Run", description: "rm -rf build" });
  });
});

import { describe, expect, it } from "vitest";
import type { Agent, OrchestratorEvent } from "@maestro/core";
import { initialModel, reduce } from "../src/reducer.js";
import { selectState } from "../src/select.js";

function agent(id: string, state: Agent["state"]): Agent {
  return {
    id, task: { id: `t-${id}`, description: "x", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state, log: [],
  };
}
const add = (a: Agent): OrchestratorEvent => ({ kind: "agent-added", agent: a });

describe("selectState", () => {
  it("floats attention cards to the top, stable by id otherwise", () => {
    let m = initialModel();
    m = reduce(m, add(agent("a3", "working")));
    m = reduce(m, add(agent("a1", "done")));     // attention
    m = reduce(m, add(agent("a2", "working")));
    const ids = selectState(m).cards.map((c) => c.id);
    expect(ids).toEqual(["a1", "a2", "a3"]); // a1 (attention) first; then a2,a3 by id
  });

  it("passes focusedId through", () => {
    const m = reduce(initialModel(), add(agent("a1", "working")));
    expect(selectState({ ...m, focusedId: "a1" }).focusedId).toBe("a1");
  });
});

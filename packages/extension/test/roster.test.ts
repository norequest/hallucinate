import { describe, expect, it } from "vitest";
import type { AgentState } from "@maestro/core";
import type { CardVM } from "@maestro/cockpit";
import { cardIcon, cardToRosterItem } from "../src/roster-map.js";

function card(over: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working", output: "", attention: false, ...over };
}

describe("roster mapping", () => {
  it("labels with the role and describes with the engine", () => {
    const item = cardToRosterItem(card());
    expect(item.id).toBe("a1");
    expect(item.label).toContain("Implementer");
    expect(item.description).toContain("copilot");
  });

  it("picks a distinct icon per state", () => {
    const states: AgentState[] = ["preparing", "working", "awaiting-approval", "done", "error", "conflict", "merged", "discarded", "stopped"];
    const icons = states.map(cardIcon);
    expect(new Set(icons).size).toBe(icons.length); // all distinct
  });

  it("flags attention cards", () => {
    expect(cardToRosterItem(card({ state: "done", attention: true })).attention).toBe(true);
  });
});

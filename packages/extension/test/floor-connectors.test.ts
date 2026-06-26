import { describe, expect, it } from "vitest";
import { connectorEdges } from "../src/webview/floor-connectors.js";
import type { TeamEdge } from "../src/webview/floor-connectors.js";

describe("connectorEdges (M10 Phase E: Floor lead->child connectors)", () => {
  it("emits one edge per present child, in memberIds order", () => {
    const teams: TeamEdge[] = [{ leadId: "a", memberIds: ["b", "c"] }];
    expect(connectorEdges(teams, new Set(["a", "b", "c"]))).toEqual([
      { leadId: "a", childId: "b" },
      { leadId: "a", childId: "c" },
    ]);
  });

  it("draws nothing for a team whose lead tile is absent", () => {
    const teams: TeamEdge[] = [{ leadId: "a", memberIds: ["b", "c"] }];
    // The lead "a" is not on the floor, so none of its edges are drawn.
    expect(connectorEdges(teams, new Set(["b", "c"]))).toEqual([]);
  });

  it("drops an edge whose child tile is absent, keeping the present one", () => {
    const teams: TeamEdge[] = [{ leadId: "a", memberIds: ["b", "c"] }];
    // "c" is missing from the floor, so only the a->b edge survives.
    expect(connectorEdges(teams, new Set(["a", "b"]))).toEqual([
      { leadId: "a", childId: "b" },
    ]);
  });

  it("skips a self-edge where a lead lists itself as a member", () => {
    const teams: TeamEdge[] = [{ leadId: "a", memberIds: ["a", "b"] }];
    // A self-referential member (parentId === id upstream) must not draw a loop
    // on its own tile; only the genuine a->b edge survives.
    expect(connectorEdges(teams, new Set(["a", "b"]))).toEqual([
      { leadId: "a", childId: "b" },
    ]);
  });

  it("returns no edges for empty teams", () => {
    expect(connectorEdges([], new Set(["a", "b"]))).toEqual([]);
  });

  it("walks multiple teams in input order, each contributing its present edges", () => {
    const teams: TeamEdge[] = [
      { leadId: "a", memberIds: ["b", "c"] },
      { leadId: "d", memberIds: ["e"] },
      { leadId: "x", memberIds: ["y"] }, // lead absent -> contributes nothing
    ];
    expect(connectorEdges(teams, new Set(["a", "b", "c", "d", "e"]))).toEqual([
      { leadId: "a", childId: "b" },
      { leadId: "a", childId: "c" },
      { leadId: "d", childId: "e" },
    ]);
  });
});

import type { AgentState } from "@maestro/core";
export type { Lane } from "./protocol.js";
import type { Lane } from "./protocol.js";

const LANE_BY_STATE: Record<AgentState, Lane> = {
  preparing: "working",
  working: "working",
  "awaiting-approval": "needsYou",
  error: "needsYou",
  detached: "needsYou",
  "merge-cleanup-failed": "needsYou",
  conflict: "conflict",
  done: "done",
  stopped: "done",
  merged: "done",
  discarded: "done",
  "pr-created": "done",
};

export function laneFor(state: AgentState): Lane {
  return LANE_BY_STATE[state];
}

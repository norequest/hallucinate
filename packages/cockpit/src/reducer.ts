import { stateNeedsAttention, countGrants, type Agent, type OrchestratorEvent } from "@hallucinate/core";
import { laneFor, isResolvedState } from "./lane.js";
import type { CardVM, DelegationVM } from "./protocol.js";

/** Max accumulated output chars kept per agent (keeps state snapshots bounded). */
export const OUTPUT_CAP = 16_000;

/** Authoritative internal state. `selectState` derives the ordered CockpitState from it. */
export interface CockpitModel {
  cards: Map<string, CardVM>;
  focusedId?: string;
  /** Pending delegation proposals keyed by id, in insertion (arrival) order. */
  delegations: Map<string, DelegationVM>;
}

export function initialModel(): CockpitModel {
  return { cards: new Map(), delegations: new Map() };
}

function diffStatFromPatch(patch: string): { adds: number; dels: number } {
  let adds = 0, dels = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) adds++;
    else if (line.startsWith("-") && !line.startsWith("---")) dels++;
  }
  return { adds, dels };
}

function cardFromAgent(
  agent: Agent,
  prevOutput: string,
  prevStartedAt: number | undefined,
  prevNeedsYouSince: number | undefined,
  prevDiffStat: { adds: number; dels: number } | undefined,
): CardVM {
  const startedAt = prevStartedAt ?? (agent.state === "working" ? Date.now() : undefined);
  // Stamp the moment this card first entered an attention state; preserve it
  // across updates while it stays in attention; clear it when it leaves.
  const needsYouSince = stateNeedsAttention(agent.state) ? (prevNeedsYouSince ?? Date.now()) : undefined;
  const diffStat = agent.diff ? diffStatFromPatch(agent.diff.patch) : undefined;
  // Momentum is the GROWTH of diffStat versus the previous card. Set it (stamped
  // now) only when the diff grew on this update; clear it otherwise, so a present
  // momentum reads as "growing right now". Each delta is clamped to >= 0 so a
  // simultaneous shrink in one axis never yields a negative.
  const prev = prevDiffStat ?? { adds: 0, dels: 0 };
  const dAdds = (diffStat?.adds ?? 0) - prev.adds;
  const dDels = (diffStat?.dels ?? 0) - prev.dels;
  const momentum =
    diffStat && (dAdds > 0 || dDels > 0)
      ? { adds: Math.max(0, dAdds), dels: Math.max(0, dDels), at: Date.now() }
      : undefined;
  const grants = countGrants(agent.role.tools);
  return {
    id: agent.id,
    roleName: agent.role.name,
    engineId: agent.role.engine.id,
    state: agent.state,
    output: prevOutput,
    tail: tailOf(prevOutput),
    summary: agent.summary,
    diff: agent.diff,
    diffError: agent.diffError,
    conflictFiles: agent.conflict?.files,
    error: agent.error,
    pendingApprovalId: agent.pendingApprovalId,
    approvalDetail: agent.approvalDetail,
    engineCapabilities: agent.engineCapabilities,
    attention: stateNeedsAttention(agent.state),
    needsYouSince,
    lane: laneFor(agent.state),
    taskDescription: agent.task.description,
    instructions: agent.role.instructions,
    goal: agent.task.goal,
    diffStat,
    momentum,
    startedAt,
    soul: agent.role.soul !== undefined,
    toolsCount: grants.granted,
    toolsCanWrite: grants.canWrite,
    skills: agent.role.skills ?? [],
    parentId: agent.parentId,
    virtual: agent.virtual,
  };
}

function appendOutput(prev: string, text: string): string {
  const next = prev + text;
  return next.length > OUTPUT_CAP ? next.slice(next.length - OUTPUT_CAP) : next;
}

/**
 * Pure: the last up to 3 non-empty (non-whitespace-only) lines of `output`,
 * for the card's live activity preview. Bounded by construction (<=3); empty
 * when there is no output yet. Derives from the already-capped `output`, so it
 * stays consistent with OUTPUT_CAP automatically.
 */
function tailOf(output: string): string[] {
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(-3);
}

/** Pure: fold one orchestrator event into a new model (never mutates the input). */
export function reduce(model: CockpitModel, event: OrchestratorEvent): CockpitModel {
  const cards = new Map(model.cards);
  const delegations = new Map(model.delegations);
  let focusedId = model.focusedId;
  switch (event.kind) {
    case "agent-added":
      // Defensively skip an agent added already resolved (rehydrate/edge cases):
      // a committed outcome (merged/discarded/pr-created) gets no card.
      if (isResolvedState(event.agent.state)) {
        cards.delete(event.agent.id);
        if (focusedId === event.agent.id) focusedId = undefined;
      } else {
        cards.set(event.agent.id, cardFromAgent(event.agent, "", undefined, undefined, undefined));
      }
      break;
    case "agent-updated": {
      // agent-added always precedes agent-updated per the orchestrator contract.
      // A resolved card auto-leaves the board: delete it instead of updating,
      // and drop the drawer focus if it pointed at this card.
      if (isResolvedState(event.agent.state)) {
        cards.delete(event.agent.id);
        if (focusedId === event.agent.id) focusedId = undefined;
        break;
      }
      const prev = cards.get(event.agent.id);
      cards.set(
        event.agent.id,
        cardFromAgent(event.agent, prev?.output ?? "", prev?.startedAt, prev?.needsYouSince, prev?.diffStat),
      );
      break;
    }
    case "agent-event": {
      const prev = cards.get(event.agentId);
      if (prev && event.event.kind === "output") {
        const output = appendOutput(prev.output, event.event.text);
        cards.set(event.agentId, { ...prev, output, tail: tailOf(output) });
      }
      break;
    }
    case "delegation-proposed": {
      const { id, leadAgentId, roleName, task } = event.proposal;
      delegations.set(id, { id, leadAgentId, roleName, task });
      break;
    }
    case "delegation-resolved":
      // Approved or denied, the proposal leaves the pending list either way.
      delegations.delete(event.proposal.id);
      break;
  }
  return { ...model, cards, delegations, focusedId };
}

/** Pure: set the focused agent. */
export function setFocus(model: CockpitModel, agentId: string): CockpitModel {
  return { ...model, focusedId: agentId };
}

import type { AgentState } from "@hallucinate/core";
import type { AttentionVM, CardVM, CockpitState } from "./protocol.js";
import type { CockpitModel } from "./reducer.js";

function compareCards(a: CardVM, b: CardVM): number {
  if (a.attention !== b.attention) return a.attention ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Attention state -> the bar's `kind` (label + primary action). Only the six
 * states for which `stateNeedsAttention` is true appear here; any other state
 * carries no attention entry.
 */
const KIND_BY_STATE: Partial<Record<AgentState, AttentionVM["kind"]>> = {
  "awaiting-approval": "approval",
  conflict: "conflict",
  done: "review",
  error: "error",
  detached: "detached",
  "merge-cleanup-failed": "cleanup",
};

/** Urgency rank by kind: a lower number sorts first (most-urgent). */
const RANK_BY_KIND: Record<AttentionVM["kind"], number> = {
  conflict: 0,
  approval: 1,
  error: 2,
  cleanup: 3,
  detached: 4,
  review: 5,
};

/**
 * Pure: the attention queue, most-urgent first. Includes only cards that need a
 * human decision (`card.attention`). Ordered by kind urgency
 * (conflict < approval < error < cleanup < detached < review); within a rank,
 * the oldest `needsYouSince` waits first (ascending; a missing timestamp sorts
 * last), with a stable tie-break on `id` so the order is deterministic.
 */
export function selectAttention(model: CockpitModel): AttentionVM[] {
  const items: AttentionVM[] = [];
  for (const card of model.cards.values()) {
    if (!card.attention) continue;
    const kind = KIND_BY_STATE[card.state];
    if (kind === undefined) continue; // defensive: attention without a known kind
    items.push({
      id: card.id,
      roleName: card.roleName,
      state: card.state,
      kind,
      pendingApprovalId: card.pendingApprovalId,
      approvalDetail: card.approvalDetail,
      since: card.needsYouSince,
    });
  }
  items.sort((a, b) => {
    const byRank = RANK_BY_KIND[a.kind] - RANK_BY_KIND[b.kind];
    if (byRank !== 0) return byRank;
    const sinceA = a.since ?? Infinity;
    const sinceB = b.since ?? Infinity;
    if (sinceA !== sinceB) return sinceA - sinceB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return items;
}

/** Pure: derive the ordered, renderable CockpitState from the model. */
export function selectState(model: CockpitModel): CockpitState {
  const cards = [...model.cards.values()].sort(compareCards);
  const delegations = [...model.delegations.values()];
  const attention = selectAttention(model);
  const base: CockpitState = { cards, delegations, attention };
  return model.focusedId === undefined ? base : { ...base, focusedId: model.focusedId };
}

import type { CardVM, CockpitState } from "./protocol.js";
import type { CockpitModel } from "./reducer.js";

function compareCards(a: CardVM, b: CardVM): number {
  if (a.attention !== b.attention) return a.attention ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Pure: derive the ordered, renderable CockpitState from the model. */
export function selectState(model: CockpitModel): CockpitState {
  const cards = [...model.cards.values()].sort(compareCards);
  return model.focusedId === undefined ? { cards } : { cards, focusedId: model.focusedId };
}

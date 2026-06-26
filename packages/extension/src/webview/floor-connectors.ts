/**
 * M10 Phase E: the Floor's lead->child connector overlay. The Floor nests a
 * lead's delegated children under it; this draws a soft curve from each lead tile
 * down to each present child tile so the team coordination reads at a glance.
 *
 * The decision of WHICH edges to draw is a pure, DOM-free function
 * (`connectorEdges`) so it is unit-testable in the node test env (no jsdom). The
 * actual SVG path drawing (`drawFloorConnectors`) is thin imperative glue over
 * the tiles' content-relative `offset*` geometry and `createElementNS`, left
 * untested the same way `tickElapsed` / `tickAttention` in app-main.ts are
 * untested DOM glue.
 */

/** A lead and its present child ids. Structurally matches cockpit's `TeamGroupVM`. */
export interface TeamEdge {
  leadId: string;
  memberIds: readonly string[];
}

/** A single lead->child connector to draw. */
export interface ConnectorEdge {
  leadId: string;
  childId: string;
}

/**
 * Pure: the lead->child edges to draw. An edge is kept only when BOTH the lead
 * tile and the child tile are present (their ids are in `presentIds`). A team
 * whose lead tile is absent contributes no edges, and a self-edge (a lead listed
 * as its own member, should upstream data ever have parentId === id) is skipped
 * so no loop is drawn on a single tile. Deterministic: teams in input order,
 * children in memberIds order.
 */
export function connectorEdges(
  teams: readonly TeamEdge[],
  presentIds: ReadonlySet<string>,
): ConnectorEdge[] {
  const edges: ConnectorEdge[] = [];
  for (const team of teams) {
    if (!presentIds.has(team.leadId)) continue;
    for (const childId of team.memberIds) {
      if (childId === team.leadId) continue; // no self-loop on one tile
      if (presentIds.has(childId)) edges.push({ leadId: team.leadId, childId });
    }
  }
  return edges;
}

/**
 * Draw lead->child connectors into the floor's `svg.floor-connectors` overlay.
 * No-op when the overlay is absent (no teams) so it is safe to call every render.
 * Idempotent: it clears the overlay first, so repeated calls never duplicate.
 */
export function drawFloorConnectors(floor: HTMLElement, teams: readonly TeamEdge[]): void {
  const svg = floor.querySelector("svg.floor-connectors");
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild); // idempotent
  const tileById = new Map<string, HTMLElement>();
  floor.querySelectorAll<HTMLElement>(".floor-tile[data-agent-id]").forEach((t) => {
    const id = t.dataset["agentId"];
    if (id) tileById.set(id, t);
  });
  const edges = connectorEdges(teams, new Set(tileById.keys()));
  for (const { leadId, childId } of edges) {
    const lead = tileById.get(leadId)!;
    const child = tileById.get(childId)!;
    // Content-relative geometry (scroll-proof): the tiles' offsetParent is the
    // position:relative `.floor` and the svg sits at its padding-box origin
    // (inset:0), so these offsets align at ANY scroll position, unlike
    // getBoundingClientRect which is viewport-relative and goes stale on scroll.
    const x1 = lead.offsetLeft + lead.offsetWidth / 2;
    const y1 = lead.offsetTop + lead.offsetHeight;
    const x2 = child.offsetLeft + child.offsetWidth / 2;
    const y2 = child.offsetTop;
    const midY = (y1 + y2) / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
    path.setAttribute("class", "connector");
    svg.appendChild(path);
  }
}

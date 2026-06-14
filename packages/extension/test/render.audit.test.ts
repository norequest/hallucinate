import { describe, it, expect } from "vitest";
import { renderCardHTML } from "../src/render.js";
import type { CardVM } from "@maestro/cockpit";

function card(overrides: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working", output: "", attention: false, ...overrides };
}

describe("render.ts: diffError on a done card (Issue 23)", () => {
  it("renders a diff-error note when a done card has diffError and no diff", () => {
    const html = renderCardHTML(card({ state: "done", attention: true, summary: "did it", diffError: "git diff failed: bad object" }));
    expect(html).toContain("diff-error");
    expect(html).toContain("git diff failed: bad object");
    // Merge/Discard must still be reachable so the user can act.
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="discard"');
  });

  it("escapes the diffError text", () => {
    const html = renderCardHTML(card({ state: "done", attention: true, diffError: "<img src=x onerror=alert(1)>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("render.ts: auto badge is gated off liveness (Issue 17-consume)", () => {
  it("shows the auto badge for a live agent whose engine lacks approvals", () => {
    const html = renderCardHTML(card({ state: "working", engineCapabilities: { approvals: false, steerable: true } }));
    expect(html).toContain('class="badge">auto');
  });

  it("does NOT show the auto badge on a detached (terminal, dead) card", () => {
    const html = renderCardHTML(card({ state: "detached", attention: true, engineCapabilities: { approvals: false, steerable: true } }));
    expect(html).not.toContain(">auto<");
  });

  it("does NOT show the auto badge on a merged card", () => {
    const html = renderCardHTML(card({ state: "merged", engineCapabilities: { approvals: false, steerable: true } }));
    expect(html).not.toContain(">auto<");
  });
});

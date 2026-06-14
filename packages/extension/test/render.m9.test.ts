import { describe, expect, it } from "vitest";
import { renderCardHTML } from "../src/render.js";
import type { CardVM } from "@maestro/cockpit";

function card(overrides: Partial<CardVM>): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "done", output: "", attention: false, ...overrides };
}

describe("renderCardHTML (M9 additions)", () => {
  it("conflict card has resolve-in-editor and finish-merge, no merge button", () => {
    const html = renderCardHTML(card({ state: "conflict", conflictFiles: ["x.ts"] }));
    expect(html).toContain('data-action="resolve-conflict"');
    expect(html).toContain('data-action="finish-merge"');
    expect(html).toContain('data-action="discard"');
    expect(html).not.toContain('data-action="merge"');
  });
  it("done card has merge, create-pr, and discard", () => {
    const html = renderCardHTML(card({ state: "done", diff: { files: ["a.ts"], patch: "" } }));
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="create-pr"');
    expect(html).toContain('data-action="discard"');
  });
  it("merge-cleanup-failed card has retry-cleanup, discard, and the note", () => {
    const html = renderCardHTML(card({ state: "merge-cleanup-failed", error: "disk full" }));
    expect(html).toContain('data-action="retry-cleanup"');
    expect(html).toContain('data-action="discard"');
    expect(html).toContain("disk full");
    expect(html).toContain("cleanup-note");
  });
  it("escapes engine output", () => {
    const html = renderCardHTML(card({ output: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

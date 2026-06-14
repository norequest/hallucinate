import { describe, expect, it } from "vitest";
import type { CardVM } from "@maestro/cockpit";
import { getStageHtml, escapeHtml, makeNonce } from "../src/html.js";
import { renderCardHTML } from "../src/render.js";

function card(over: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working", output: "", attention: false, ...over };
}

describe("getStageHtml", () => {
  it("embeds the script with the nonce and a CSP", () => {
    const html = getStageHtml("script.js", "style.css", "ABC123", "vscode-resource:");
    expect(html).toContain('nonce="ABC123"');
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("script.js");
    expect(html).toContain("style.css");
  });
  it("makeNonce yields a 32-char alphanumeric token", () => {
    expect(makeNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
  });
  it("escapeHtml neutralizes markup", () => {
    expect(escapeHtml('<script>"&')).toBe("&lt;script&gt;&quot;&amp;");
  });
});

describe("renderCardHTML", () => {
  it("shows live output while working and a Stop control", () => {
    const html = renderCardHTML(card({ output: "compiling..." }));
    expect(html).toContain("compiling...");
    expect(html).toContain('data-action="stop"');
  });
  it("shows summary + diff files + Merge/Discard when done", () => {
    const html = renderCardHTML(card({ state: "done", attention: true, summary: "did it", diff: { files: ["a.ts", "b.ts"], patch: "P" } }));
    expect(html).toContain("did it");
    expect(html).toContain("a.ts");
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="discard"');
  });
  it("shows conflict files and Discard on conflict", () => {
    const html = renderCardHTML(card({ state: "conflict", attention: true, conflictFiles: ["x.ts"] }));
    expect(html).toContain("x.ts");
    expect(html).toContain('data-action="discard"');
    expect(html).not.toContain('data-action="merge"');
  });
  it("shows the error tail on error", () => {
    const html = renderCardHTML(card({ state: "error", attention: true, error: "boom" }));
    expect(html).toContain("boom");
  });
  it("escapes output so engine text cannot inject markup", () => {
    const html = renderCardHTML(card({ output: "<img src=x onerror=alert(1)>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

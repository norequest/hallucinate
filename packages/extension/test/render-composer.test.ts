import { describe, expect, it } from "vitest";
import { renderComposerHTML } from "../src/render-composer.js";
import { composerOptions } from "@maestro/cockpit";

const opts = composerOptions(
  [{ name: "Test Author", instructions: "<b>write</b> tests", engine: { id: "copilot" }, autonomy: "auto-approve-safe" }],
  [{ name: "Strike", roles: [] }],
);
describe("renderComposerHTML", () => {
  it("renders a preset chip with the role name and engine", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain("Test Author");
    expect(html).toContain("copilot");
    expect(html).toContain('data-role="Test Author"');
  });
  it("renders engine pills for every family and model variant", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain('data-engine="copilot"');
    expect(html).toContain('data-engine="acp"');
    expect(html).toContain("claude-sonnet-4.5");
    expect(html).toContain("gemini");
  });
  it("renders the goal + task fields and a dispatch button", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain("so that");
    expect(html).toContain('data-action="dispatch"');
    expect(html).toContain('data-action="new-role"');
  });
  it("escapes role names and instruction snippets (no markup injection)", () => {
    const evil = composerOptions(
      [{ name: "<img src=x>", instructions: "<script>alert(1)</script>", engine: { id: "copilot" }, autonomy: "manual" }],
      [],
    );
    const html = renderComposerHTML(evil);
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;img");
  });
});

import { describe, expect, it } from "vitest";
import { renderAnatomyRail, renderAnatomyCanvas, renderGrantGate } from "../src/anatomy-render.js";
import type { AnatomyVM } from "../src/anatomy-protocol.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function baseVM(overrides?: Partial<AnatomyVM>): AnatomyVM {
  return {
    roleName: "Tester",
    instructions: "Run all tests before merging.",
    engineId: "copilot",
    autonomy: "manual",
    soulBody: "",
    toolsSummary: { granted: 0, canWrite: 0 },
    skills: [],
    ...overrides,
  };
}

// ─── renderAnatomyRail ────────────────────────────────────────────────────────

describe("renderAnatomyRail", () => {
  it("renders all 7 section rows", () => {
    const html = renderAnatomyRail(baseVM());
    const sections = ["identity", "soul", "instructions", "tools", "skills", "engine", "autonomy"];
    for (const s of sections) {
      expect(html).toContain(`data-section="${s}"`);
    }
  });

  it("shows a filled dot on identity when roleName is non-empty", () => {
    const html = renderAnatomyRail(baseVM({ roleName: "Tester" }));
    // The identity row should contain a filled dot
    expect(html).toContain('anatomy-dot filled');
  });

  it("shows a filled dot on soul when soulName is set", () => {
    const html = renderAnatomyRail(baseVM({ soulName: "careful-soul" }));
    expect(html).toContain("anatomy-dot filled");
  });

  it("does not mark soul as filled when soulName is absent", () => {
    // Create a VM with only instructions filled so we can count carefully
    const html = renderAnatomyRail(baseVM({
      soulName: undefined,
      instructions: "",
      toolsSummary: { granted: 0, canWrite: 0 },
      skills: [],
    }));
    // Only identity (roleName "Tester") and engine (engineId "copilot") + autonomy are filled
    // Soul should NOT be filled
    // Find the soul row
    const soulRowMatch = html.match(/data-section="soul"[\s\S]*?<\/div>/);
    expect(soulRowMatch).not.toBeNull();
    expect(soulRowMatch![0]).not.toContain("filled");
  });

  it("marks tools as filled when granted > 0", () => {
    const html = renderAnatomyRail(baseVM({ toolsSummary: { granted: 2, canWrite: 0 } }));
    expect(html).toContain("anatomy-dot filled");
  });

  it("marks skills as filled when skills array is non-empty", () => {
    const html = renderAnatomyRail(baseVM({ skills: [{ name: "run-tests" }] }));
    expect(html).toContain("anatomy-dot filled");
  });

  it("has exactly 7 rail rows", () => {
    const html = renderAnatomyRail(baseVM());
    const matches = html.match(/anatomy-rail-row/g) ?? [];
    expect(matches.length).toBe(7);
  });
});

// ─── renderAnatomyCanvas ──────────────────────────────────────────────────────

describe("renderAnatomyCanvas", () => {
  it("renders a tools grid with all 5 builtin tools", () => {
    const html = renderAnatomyCanvas(baseVM());
    for (const tool of ["Read", "Search", "Edit", "Run", "Git"]) {
      expect(html).toContain(`data-tool="${tool}"`);
    }
  });

  it("write toggles are unchecked by default (no grants)", () => {
    const html = renderAnatomyCanvas(baseVM());
    // There should be no checked write checkboxes
    // All write checkboxes should be unchecked (no "checked" adjacent to data-mode="write")
    const writeInputs = html.match(/data-mode="write"[^>]*/g) ?? [];
    for (const input of writeInputs) {
      expect(input).not.toContain("checked");
    }
  });

  it("shows write toggle unchecked for a read-only role (read granted, no write)", () => {
    const vm = baseVM({
      tools: { builtins: { read: ["Read"], write: [] } },
      toolsSummary: { granted: 1, canWrite: 0 },
    });
    const html = renderAnatomyCanvas(vm);
    const writeInputs = html.match(/data-mode="write"[^>]*/g) ?? [];
    for (const input of writeInputs) {
      expect(input).not.toContain("checked");
    }
  });

  it("shows write toggle checked when Git write is granted", () => {
    const vm = baseVM({
      tools: { builtins: { write: ["Git"] } },
      toolsSummary: { granted: 1, canWrite: 1 },
    });
    const html = renderAnatomyCanvas(vm);
    // The Git write row should be checked
    expect(html).toContain("checked");
  });

  it("renders the granted summary line", () => {
    const vm = baseVM({ toolsSummary: { granted: 2, canWrite: 1 } });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("2 granted");
    expect(html).toContain("1 can write");
  });

  it("the can-write count has amber class when canWrite > 0", () => {
    const vm = baseVM({ toolsSummary: { granted: 2, canWrite: 1 } });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain('anatomy-tools-can-write amber');
  });

  it("the can-write count does NOT have amber class when canWrite is 0", () => {
    const vm = baseVM({ toolsSummary: { granted: 1, canWrite: 0 } });
    const html = renderAnatomyCanvas(vm);
    // Should not have "amber" on the can-write span
    expect(html).not.toContain('anatomy-tools-can-write amber');
    expect(html).toContain('anatomy-tools-can-write');
  });

  it("renders skill chips with the skill name", () => {
    const vm = baseVM({ skills: [{ name: "run-tests" }, { name: "openapi" }] });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("run-tests");
    expect(html).toContain("openapi");
  });

  it("renders the soul textarea prefilled with soulBody", () => {
    const vm = baseVM({ soulBody: "You are careful." });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain('data-action="role-set-soul"');
    expect(html).toContain("You are careful.");
  });

  it("renders the instructions textarea", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain('data-action="role-set-instructions"');
  });

  it("renders the active autonomy button with active class", () => {
    const vm = baseVM({ autonomy: "auto-approve-safe" });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain('data-value="auto-approve-safe"');
    // The auto-approve-safe button should have the active class
    const activeMatch = html.match(/anatomy-autonomy-btn active[^>]*data-value="auto-approve-safe"/);
    expect(activeMatch).not.toBeNull();
  });

  it("renders the engine pill as active", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain('anatomy-engine-pill active');
    expect(html).toContain("copilot");
  });
});

// ─── renderGrantGate ──────────────────────────────────────────────────────────

describe("renderGrantGate", () => {
  it("contains 'needs' in the copy", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain("needs");
  });

  it("names the missing tool (Git)", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain("Git");
  });

  it("has a grant button with data-action='grant'", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain('data-action="grant"');
  });

  it("has an attach-anyway button with data-action='attach-anyway'", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain('data-action="attach-anyway"');
  });

  it("has a cancel button with data-action='cancel-grant'", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain('data-action="cancel-grant"');
  });

  it("does NOT contain a silent attach (no auto-grant)", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    // There should be no hidden auto-grant mechanism
    expect(html).not.toContain("auto-grant");
    expect(html).not.toContain("silently");
  });

  it("contains the skill name in the output", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain("run-tests");
  });

  // ─── XSS escaping ─────────────────────────────────────────────────────────

  it("escapes an <img onerror> in a soul body (via renderAnatomyCanvas)", () => {
    const vm = baseVM({ soulBody: '<img onerror="alert(1)">' });
    const html = renderAnatomyCanvas(vm);
    expect(html).not.toContain('<img');
    expect(html).toContain("&lt;img");
  });

  it("escapes an <img onerror> in a skill name (via renderAnatomyCanvas)", () => {
    const vm = baseVM({ skills: [{ name: '<script>alert(1)</script>' }] });
    const html = renderAnatomyCanvas(vm);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a skill name in the grant-gate", () => {
    const html = renderGrantGate(
      '<img onerror="x">',
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).not.toContain('<img');
    expect(html).toContain("&lt;img");
  });

  it("escapes a role name in the grant-gate", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      '<script>bad()</script>'
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain("&lt;script&gt;");
  });
});

import { describe, expect, it } from "vitest";
import { isLibraryMessage } from "../src/library-protocol.js";

describe("isLibraryMessage", () => {
  // ─── accepts well-formed variants ─────────────────────────────────────────

  it("accepts open-library", () => {
    expect(isLibraryMessage({ type: "open-library" })).toBe(true);
  });

  it("accepts switch-library-tab with valid tab", () => {
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "agents" })).toBe(true);
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "teams" })).toBe(true);
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "skills" })).toBe(true);
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "discover" })).toBe(true);
  });

  it("accepts skill-create", () => {
    expect(isLibraryMessage({ type: "skill-create" })).toBe(true);
  });

  it("accepts skill-save with required fields", () => {
    expect(
      isLibraryMessage({ type: "skill-save", name: "mySkill", description: "desc", body: "body" })
    ).toBe(true);
  });

  it("accepts skill-save with optional allowedTools", () => {
    expect(
      isLibraryMessage({
        type: "skill-save",
        name: "mySkill",
        description: "desc",
        body: "body",
        allowedTools: ["Bash", "Read"],
      })
    ).toBe(true);
  });

  it("accepts skill-delete", () => {
    expect(isLibraryMessage({ type: "skill-delete", name: "mySkill" })).toBe(true);
  });

  it("accepts attach-skill", () => {
    expect(
      isLibraryMessage({ type: "attach-skill", roleName: "Tester", skillName: "run-tests" })
    ).toBe(true);
  });

  it("accepts detach-skill", () => {
    expect(
      isLibraryMessage({ type: "detach-skill", roleName: "Tester", skillName: "run-tests" })
    ).toBe(true);
  });

  // ─── rejects invalid messages ──────────────────────────────────────────────

  it("rejects null", () => {
    expect(isLibraryMessage(null)).toBe(false);
  });

  it("rejects a non-object (string)", () => {
    expect(isLibraryMessage("open-library")).toBe(false);
  });

  it("rejects a non-object (number)", () => {
    expect(isLibraryMessage(42)).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(isLibraryMessage({ type: "unknown-type" })).toBe(false);
  });

  it("rejects switch-library-tab with missing tab", () => {
    expect(isLibraryMessage({ type: "switch-library-tab" })).toBe(false);
  });

  it("rejects switch-library-tab with invalid tab value", () => {
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "invalid" })).toBe(false);
    expect(isLibraryMessage({ type: "switch-library-tab", tab: 42 })).toBe(false);
  });

  it("rejects attach-skill missing skillName", () => {
    expect(isLibraryMessage({ type: "attach-skill", roleName: "Tester" })).toBe(false);
  });

  it("rejects attach-skill missing roleName", () => {
    expect(isLibraryMessage({ type: "attach-skill", skillName: "run-tests" })).toBe(false);
  });

  it("rejects detach-skill missing skillName", () => {
    expect(isLibraryMessage({ type: "detach-skill", roleName: "Tester" })).toBe(false);
  });

  it("rejects skill-save with non-string name", () => {
    expect(
      isLibraryMessage({ type: "skill-save", name: 123, description: "desc", body: "body" })
    ).toBe(false);
  });

  it("rejects skill-save with missing name", () => {
    expect(isLibraryMessage({ type: "skill-save", description: "desc", body: "body" })).toBe(
      false
    );
  });

  it("rejects skill-save with missing description", () => {
    expect(isLibraryMessage({ type: "skill-save", name: "foo", body: "body" })).toBe(false);
  });

  it("rejects skill-save with missing body", () => {
    expect(isLibraryMessage({ type: "skill-save", name: "foo", description: "desc" })).toBe(false);
  });

  it("rejects skill-save with allowedTools present but not a string[]", () => {
    expect(
      isLibraryMessage({
        type: "skill-save",
        name: "foo",
        description: "desc",
        body: "body",
        allowedTools: "Bash",
      })
    ).toBe(false);
  });

  it("rejects skill-save with allowedTools containing a non-string element", () => {
    expect(
      isLibraryMessage({
        type: "skill-save",
        name: "foo",
        description: "desc",
        body: "body",
        allowedTools: ["Bash", 42],
      })
    ).toBe(false);
  });

  it("rejects skill-delete with missing name", () => {
    expect(isLibraryMessage({ type: "skill-delete" })).toBe(false);
  });

  it("rejects skill-delete with non-string name", () => {
    expect(isLibraryMessage({ type: "skill-delete", name: 123 })).toBe(false);
  });

  it("rejects object with no type field", () => {
    expect(isLibraryMessage({ roleName: "Tester" })).toBe(false);
  });
});

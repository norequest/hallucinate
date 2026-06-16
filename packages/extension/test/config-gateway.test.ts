import { describe, expect, it } from "vitest";
import { makeConfigGateway } from "../src/config-gateway.js";

/**
 * R6 containment: the gateway must refuse skill/role names that are not a clean
 * single path segment, BEFORE building any filesystem path, so a write or remove
 * can never escape .conductor/. assertSafeSegment runs ahead of any fs access, so
 * these reject without touching disk.
 */
describe("config-gateway · path-segment containment (R6)", () => {
  const gw = makeConfigGateway("/tmp/maestro-test-repo");

  it("refuses a traversal skill name on save", async () => {
    await expect(gw.saveSkill({ name: "../../etc", description: "x" }, "body")).rejects.toThrow(
      /single path segment/,
    );
  });

  it("refuses a separator-bearing skill name on save", async () => {
    await expect(gw.saveSkill({ name: "a/b", description: "x" }, "body")).rejects.toThrow(
      /single path segment/,
    );
  });

  it("refuses a traversal skill name on delete", async () => {
    await expect(gw.deleteSkill("../../../etc")).rejects.toThrow(/single path segment/);
  });

  it('refuses "." and ".." skill names', async () => {
    await expect(gw.deleteSkill("..")).rejects.toThrow(/single path segment/);
    await expect(gw.deleteSkill(".")).rejects.toThrow(/single path segment/);
  });

  it("refuses a backslash-bearing skill name", async () => {
    await expect(gw.deleteSkill("a\\b")).rejects.toThrow(/single path segment/);
  });
});

/** Which tab is active in the Library panel. */
export type LibraryTab = "agents" | "teams" | "skills" | "discover";

/** A single skill's renderable data in the Library panel. */
export interface SkillCardVM {
  name: string;
  description: string;
  /** DECLARED requirements, never a grant (R5). */
  allowedTools?: string[];
  /** "plugin" triggers a From-plugin badge (adoption is P5; default "authored"). */
  source: "authored" | "plugin";
  /** Blast radius: which roles use this skill. Amber at length >= 3. */
  usedBy: { roleName: string; engineId: string }[];
}

/** The whole Library snapshot, a pure function of config state. */
export interface LibrarySnapshot {
  tab: LibraryTab;
  skills: SkillCardVM[];
  /** Read-only Agents tab data. */
  roles: { name: string; engineId: string; skills: string[] }[];
  /** Read-only Teams tab data. */
  teams: { name: string; roleNames: string[] }[];
  /** Open skill editor; name === "" signals create-mode. */
  editing?: SkillCardVM;
  /** Open Add-skill picker bound to a role. */
  picker?: { roleName: string };
}

/** Messages the extension host sends INTO the Library webview. */
export type HostToLibrary = { type: "library-state"; snapshot: LibrarySnapshot };

/** Messages the Library webview sends OUT to the extension host. */
export type LibraryToHost =
  | { type: "open-library" }
  | { type: "switch-library-tab"; tab: LibraryTab }
  | { type: "skill-create" }
  | { type: "skill-save"; name: string; description: string; body: string; allowedTools?: string[] }
  | { type: "skill-delete"; name: string }
  | { type: "attach-skill"; roleName: string; skillName: string }
  | { type: "detach-skill"; roleName: string; skillName: string };

// ─── Runtime guard ────────────────────────────────────────────────────────────

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptStringArray(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((item) => isString(item));
}

const LIBRARY_TABS = new Set<string>(["agents", "teams", "skills", "discover"]);

/**
 * Pure runtime guard for the Library webview->host boundary. The webview is a
 * separate, potentially-compromised JS context, so its postMessage payloads are
 * untrusted `unknown`. This narrows them to a real LibraryToHost, letting the
 * host drop anything malformed before it reaches the controller.
 */
export function isLibraryMessage(msg: unknown): msg is LibraryToHost {
  if (msg === null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (!isString(m["type"])) return false;
  const type = m["type"];

  switch (type) {
    case "open-library":
    case "skill-create":
      return true;
    case "switch-library-tab":
      return isString(m["tab"]) && LIBRARY_TABS.has(m["tab"] as string);
    case "skill-save":
      return (
        isString(m["name"]) &&
        isString(m["description"]) &&
        isString(m["body"]) &&
        isOptStringArray(m["allowedTools"])
      );
    case "skill-delete":
      return isString(m["name"]);
    case "attach-skill":
    case "detach-skill":
      return isString(m["roleName"]) && isString(m["skillName"]);
    default:
      return false;
  }
}

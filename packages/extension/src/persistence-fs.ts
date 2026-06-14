import { mkdir, readFile, appendFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { PersistenceBackend } from "./persistence.js";

/**
 * Production backend: one JSONL file per agent under
 * `.conductor/.runtime/<agentId>.jsonl` in the workspace root. The directory is
 * gitignored and created lazily on first write.
 */
export class FsPersistenceBackend implements PersistenceBackend {
  private readonly dir: string;

  constructor(repoRoot: string) {
    this.dir = join(repoRoot, ".conductor", ".runtime");
  }

  private filePath(agentId: string): string {
    const safe = agentId.replace(/[/\\]/g, "_");
    return join(this.dir, `${safe}.jsonl`);
  }

  async read(agentId: string): Promise<string> {
    try {
      return await readFile(this.filePath(agentId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  }

  async append(agentId: string, line: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.filePath(agentId), line, "utf8");
  }

  async listAgentIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir);
      return entries.filter((e) => e.endsWith(".jsonl")).map((e) => e.slice(0, -".jsonl".length));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async remove(agentId: string): Promise<void> {
    try {
      await unlink(this.filePath(agentId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}

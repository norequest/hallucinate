import type { Workspace } from "./types.js";

/** Abstracts worktree creation so the orchestrator stays pure and testable. */
export interface WorkspaceProvider {
  create(agentId: string): Promise<Workspace>;
  cleanup(agentId: string): Promise<void>;
}

/** In-memory provider for tests and for the no-real-CLI milestone. */
export class FakeWorkspaceProvider implements WorkspaceProvider {
  readonly created: string[] = [];
  readonly cleaned: string[] = [];
  private failOn?: string;

  /** Configure the provider to throw when creating a workspace for `agentId`. */
  failCreateFor(agentId: string): void {
    this.failOn = agentId;
  }

  create(agentId: string): Promise<Workspace> {
    if (this.failOn === agentId) {
      return Promise.reject(new Error("worktree add failed"));
    }
    this.created.push(agentId);
    return Promise.resolve({
      agentId,
      path: `/tmp/maestro/${agentId}`,
      branch: `agent/${agentId}`,
    });
  }

  cleanup(agentId: string): Promise<void> {
    this.cleaned.push(agentId);
    return Promise.resolve();
  }
}

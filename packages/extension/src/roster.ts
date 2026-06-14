import * as vscode from "vscode";
import type { CockpitState } from "@maestro/cockpit";
import { cardToRosterItem, type RosterItem } from "./roster-map.js";

/** Thin TreeDataProvider over the latest CockpitState. */
export class RosterTreeDataProvider implements vscode.TreeDataProvider<RosterItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: RosterItem[] = [];

  update(state: CockpitState): void {
    this.items = state.cards.map(cardToRosterItem);
    this.changed.fire();
  }

  getChildren(): RosterItem[] {
    return this.items;
  }

  getTreeItem(item: RosterItem): vscode.TreeItem {
    const ti = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
    ti.id = item.id;
    ti.description = item.description;
    ti.tooltip = item.tooltip;
    ti.iconPath = new vscode.ThemeIcon(item.icon);
    ti.contextValue = item.attention ? "maestro-agent-attention" : "maestro-agent";
    ti.command = { command: "maestro.focusAgent", title: "Focus", arguments: [item.id] };
    return ti;
  }
}

/**
 * Dashboard-View (T7, ADR-0008): Obsidian-ItemView-Shell, analog SidebarView.
 * Rendering lebt obsidian-frei in dashboard-render.ts (Node-testbar).
 */
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import {
  renderDashboard,
  VIEW_TYPE_ISERV_DASHBOARD,
  type DashboardData,
} from "./dashboard-render";

export { VIEW_TYPE_ISERV_DASHBOARD } from "./dashboard-render";
export type { DashboardData } from "./dashboard-render";

/** Obsidian-ItemView-Shell (echtes Plugin): Grid-Layout ohne Stats-Reihe (ADR-0004). */
export class IServDashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_ISERV_DASHBOARD;
  }

  getDisplayText(): string {
    return "IServ Dashboard";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("iserv-dashboard-host");
    this.contentEl.createDiv({ cls: "iserv-dashboard iserv-loading" }).setText(
      "IServ wird geladen …"
    );
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Von außen (Plugin) mit Daten befüllen (wie SidebarView.update). */
  update(data: DashboardData): void {
    try {
      renderDashboard(this.contentEl, data);
    } catch (err) {
      new Notice(`IServ-Dashboard-Fehler: ${String(err)}`);
    }
  }
}

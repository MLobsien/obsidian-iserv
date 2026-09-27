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
    const plugin = (this.app as unknown as { plugins?: { plugins?: Record<string, { refreshDashboard?: () => Promise<void> }> } }).plugins?.plugins?.[
      "iserv-integration"
    ];
    if (plugin?.refreshDashboard) {
      void plugin.refreshDashboard().catch(() => undefined);
    }
  }

  /** Lade-/Fehlerzustand (statt ewigem Loading-Screen). */
  updateError(message: string): void {
    this.contentEl.empty();
    const box = this.contentEl.createDiv({ cls: "iserv-error-state" });
    box.createDiv({ cls: "iserv-error-title" }).setText("IServ nicht verfügbar");
    box.createDiv({ cls: "iserv-error-detail" }).setText(message);
    const retry = box.createEl("button", { text: "Erneut versuchen", cls: "iserv-error-retry" });
    retry.type = "button";
    retry.addEventListener("click", () => {
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: "iserv-sidebar iserv-loading" }).setText("IServ wird geladen …");
      const plugin = (this.app as unknown as { plugins?: { plugins?: Record<string, { refreshDashboard?: () => Promise<void> }> } }).plugins?.plugins?.[
        "iserv-integration"
      ];
      if (plugin?.refreshDashboard) {
        void plugin.refreshDashboard().catch(() => undefined);
      }
    });
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Von außen (Plugin) mit Daten befüllen (wie SidebarView.update). */
  update(data: DashboardData): void {
    try {
      // Day-Pager-State im ViewModel (T26-Kritik: eine Tag-Spalte statt 5er-Grid).
      // Offset bleibt über Daten-Refreshes hinweg erhalten (neuer Daten-Snapshot
      // überschreibt nicht den verschiebuser-moved Tag).
      if (data.dayOffset === undefined && this.dayOffset !== undefined) {
        data = { ...data, dayOffset: this.dayOffset };
      }
      if (!data.onOffsetChange) {
        data = {
          ...data,
          onOffsetChange: (offset) => {
            this.dayOffset = offset;
            if (this.lastData) {
              renderDashboard(this.contentEl, { ...this.lastData, dayOffset: offset });
            }
          },
        };
      }
      this.lastData = data;
      renderDashboard(this.contentEl, data);
    } catch (err) {
      new Notice(`IServ-Dashboard-Fehler: ${String(err)}`);
    }
  }

  /** Letzte Befüllung (für Pager-Re-Render ohne Refetch). */
  private lastData: DashboardData | null = null;
  /** angezeigter Tag relativ zu heute (0 = heute, State im ViewModel). */
  private dayOffset: number | undefined = undefined;
}

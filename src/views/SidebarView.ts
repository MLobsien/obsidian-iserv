/**
 * Sidebar-View (T6, ADR-0008): Obsidian-ItemView-Shell.
 * Rendering lebt obsidian-frei in sidebar-render.ts (Node-testbar).
 */
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import {
  renderSidebarSections,
  VIEW_TYPE_ISERV_SIDEBAR,
  type SidebarData,
} from "./sidebar-render";

export { VIEW_TYPE_ISERV_SIDEBAR } from "./sidebar-render";
export type { SidebarData, SidebarExam } from "./sidebar-render";

/** Obsidian-ItemView-Shell (echtes Plugin). */
export class IServSidebarView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_ISERV_SIDEBAR;
  }

  getDisplayText(): string {
    return "IServ";
  }

  getIcon(): string {
    return "school";
  }

  async onOpen(): Promise<void> {
    this.renderLoading();
    // View ohne Command geöffnet (Layout-Restore): initial nachladen, sonst
    // bleibt "IServ wird geladen …" ewig stehen (User-Report 2026-09-27).
    const plugin = (this.app as unknown as { plugins?: { plugins?: Record<string, { refreshSidebar?: () => Promise<void> }> } }).plugins?.plugins?.[
      "iserv-integration"
    ];
    if (plugin?.refreshSidebar) {
      void plugin.refreshSidebar().catch(() => undefined);
    }
  }

  private renderLoading(): void {
    this.contentEl.empty();
    this.contentEl.createDiv({ cls: "iserv-sidebar iserv-loading" }).setText(
      "IServ wird geladen …"
    );
  }

  /** Lade-/Fehlerzustand (statt ewigem Loading-Screen). */
  updateError(message: string): void {
    this.contentEl.empty();
    const box = this.contentEl.createDiv({ cls: "iserv-error-state" });
    box.createDiv({ cls: "iserv-error-title" }).setText("IServ nicht verbunden");
    box.createDiv({ cls: "iserv-error-detail" }).setText(message);
    const retry = box.createEl("button", { text: "Erneut versuchen", cls: "iserv-error-retry" });
    retry.type = "button";
    retry.addEventListener("click", () => {
      this.renderLoading();
      const plugin = (this.app as unknown as { plugins?: { plugins?: Record<string, { refreshSidebar?: () => Promise<void> }> } }).plugins?.plugins?.[
        "iserv-integration"
      ];
      if (plugin?.refreshSidebar) {
        void plugin.refreshSidebar().catch(() => undefined);
      }
    });
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Von außen (Plugin) mit Daten befüllen. */
  update(data: SidebarData): void {
    try {
      renderSidebarSections(this.contentEl, data);
    } catch (err) {
      new Notice(`IServ-Sidebar-Fehler: ${String(err)}`);
    }
  }
}

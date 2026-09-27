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
    this.contentEl.createDiv({ cls: "iserv-sidebar iserv-loading" }).setText(
      "IServ wird geladen …"
    );
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

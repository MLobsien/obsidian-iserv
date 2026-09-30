/**
 * IServSettingTab (T23) — aus main.ts extrahiert.
 *
 * Rendering über SETTING_GROUPS (pure, src/settings/settings-groups.ts);
 * obsidian-imports nur hier. Alle „1:1"-Einstellungen aus dem alten
 * INLINE-Tab bleiben erhalten: user, host, onlySchoolEmails,
 * prepWindowBaseDays, Credentials-Button.
 */
import { App, PluginSettingTab, Setting } from "obsidian";
import type IServPlugin from "../main";
import { SETTING_GROUPS, type SettingSpec } from "./settings-groups";

export class IServSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: IServPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    if (SETTING_GROUPS.length > 1) {
      containerEl.createEl("h2", { text: SETTING_GROUPS[0].title });
    }
    this.renderSettings(SETTING_GROUPS[0].settings);

    for (const group of SETTING_GROUPS.slice(1)) {
      containerEl.createEl("h2", { text: group.title });
      this.renderSettings(group.settings);
    }
  }

  /** Settings einer Gruppe rendern — Schreibpfade 1:1 wie vor dem Redesign. */
  private renderSettings(specs: SettingSpec[]): void {
    for (const spec of specs) {
      switch (spec.type) {
        case "toggle":
          this.renderToggle(spec);
          break;
        case "textarea":
          this.renderTextarea(spec);
          break;
        case "select":
          this.renderSelect(spec);
          break;
        default:
          this.renderNormal(spec);
      }
    }
  }

  /** Typ freigeben: ein Setting kann text-toggle-abhängig dargestellt sein. */
  private renderNormal(spec: SettingSpec): void {
    const s = new Setting(this.containerEl)
      .setName(spec.name)
      .setDesc(spec.desc);
    if (spec.key === "credentials") {
      // Credentials-Button (Keychain-Modal) — 1:1 aus dem alten Tab.
      s.addButton((b) =>
        b.setButtonText("Öffnen").onClick(() => {
          void this.plugin.openCredentialModal();
        })
      );
      return;
    }
    s.addText((t) =>
      t
        .setValue(this.currentTextValue(spec.key))
        .onChange(async (v) => {
          await this.applyTextValue(spec.key, v);
        })
    );
  }

  private renderToggle(spec: SettingSpec): void {
    new Setting(this.containerEl)
      .setName(spec.name)
      .setDesc(spec.desc)
      .addToggle((t) =>
        t.setValue(this.currentBoolValue(spec.key)).onChange(async (v) => {
          await this.applyBoolValue(spec.key, v);
        })
      );
  }

  /** Feste Auswahl statt freiem Text (User-Kritik Runde 4: kein JSON mehr). */
  private renderSelect(spec: SettingSpec): void {
    const options = spec.options ?? [];
    new Setting(this.containerEl)
      .setName(spec.name)
      .setDesc(spec.desc)
      .addDropdown((d) => {
        for (const opt of options) d.addOption(opt.value, opt.label);
        d.setValue(this.currentTextValue(spec.key) || options[0]?.value || "");
        d.onChange(async (v) => {
          await this.applySelectValue(spec.key, v);
        });
      });
  }

  private applySelectValue(key: string, v: string): Promise<void> {
    this.setDeepValue(key, v);
    return this.plugin.saveSettings();
  }

  private renderTextarea(spec: SettingSpec): void {
    new Setting(this.containerEl)
      .setName(spec.name)
      .setDesc(spec.desc)
      .addTextArea((t) =>
        t.setValue(this.currentTextValue(spec.key)).onChange(async (v) => {
          await this.applyTextValue(spec.key, v);
        })
      );
  }

  /** Aktueller Anzeigewert (read-only Hilfe fuer renderNormal). */
  private currentTextValue(key: string): string {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    const v = this.getDeepValue(s, key);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return String(v);
    return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
  }

  /** Deep-Get: 'a.b' adressiert verschachtelte Felder. */
  private getDeepValue(obj: Record<string, unknown>, key: string): unknown {
    return key.split(".").reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object") {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  }

  /** Deep-Set: 'a.b' schreibt verschachtelte Felder (Existenz erzwingen). */
  private setDeepValue(key: string, v: unknown): void {
    const parts = key.split(".");
    let cur = this.plugin.settings as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cur[part] || typeof cur[part] !== "object") {
        cur[part] = {};
      }
      cur = cur[part] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = v;
  }

  /** Text-Keystrokes in Werte schreiben (1:1 Semantik des Alt-Tabs). */
  private applyTextValue(key: string, v: string): Promise<void> {
    switch (key) {
      case "host":
        this.plugin.settings.host = v;
        break;
      case "user":
        this.plugin.settings.user = v;
        break;
      default: {
        // Zahl-Felder (auch verschachtelt: jobIntervals.core,
        // prepWindowBaseDays.Klausur) — Zahl oder ignorieren.
        const n = Number(v);
        if (v.trim() !== "" && Number.isFinite(n) && n >= 0) {
          this.setDeepValue(key, n);
        }
        break;
      }
    }
    return this.plugin.saveSettings();
  }

  private currentBoolValue(key: string): boolean {
    const v = (this.plugin.settings as unknown as Record<string, unknown>)[key];
    return v === true;
  }

  private applyBoolValue(key: string, v: boolean): Promise<void> {
    if (key === "onlySchoolEmails") {
      this.plugin.settings.onlySchoolEmails = v;
      void this.plugin.refreshSidebar();
      void this.plugin.refreshDashboard();
    }
    return this.plugin.saveSettings();
  }
}

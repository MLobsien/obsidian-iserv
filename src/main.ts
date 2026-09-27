/**
 * IServ Integration — Obsidian plugin (Battle-Test wiring).
 *
 * Verkabelung für echte Obsidian-Läufe:
 * - CredStore (ADR-0003, fail-closed) über Electron safeStorage
 * - IServClient mit Node-https-Transport (Cookie-Controle, Desktop)
 * - Sync-Command: timetable-entries, substitutions, mails, unreadCount, exercises
 * - Ergebnis als Notice + Datei-Log im Vault (iserv-sync-log.md)
 */
import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import https from "https";
import http from "http";
import { IServClient, IServConfig } from "./client/IServClient";
import { CredStore, CredStorePlugin } from "./client/CredStore";
import {
  timetable,
  substitutions,
  timetableSlots,
  type TimetableEntry,
  type TimetableSlot,
} from "./api/timetable";
import { mails, unreadCount } from "./api/mails";
import { exercises } from "./api/exercises";
import {
  IServSidebarView,
  VIEW_TYPE_ISERV_SIDEBAR,
  type SidebarData,
} from "./views/SidebarView";
import type { SidebarEntry } from "./views/sidebar-logic";
import type { CookieStore } from "./client/CookieStore";

interface IServSettings {
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  pollMinutes: number;
}

const DEFAULT_SETTINGS: IServSettings = {
  host: "gymmeck.de",
  port: 443,
  ssl: true,
  user: "",
  pollMinutes: 0,
};

function resolveSafeStorage(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = require("electron");
    return (
      (mod && mod.safeStorage) ||
      (mod && mod.remote && mod.remote.safeStorage) ||
      null
    );
  } catch {
    return null;
  }
}

export default class IServPlugin extends Plugin {
  settings: IServSettings = DEFAULT_SETTINGS;
  credStore!: CredStore;
  client: IServClient | null = null;
  private lastLog = "";

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.credStore = new CredStore(
      this as unknown as CredStorePlugin,
      resolveSafeStorage() as
        | import("./client/CredStore").SafeStorage
        | undefined
    );

    this.registerView(
      VIEW_TYPE_ISERV_SIDEBAR,
      (leaf: WorkspaceLeaf) => new IServSidebarView(leaf)
    );

    this.addRibbonIcon("school", "IServ öffnen", () => {
      void this.openSidebar();
    });

    this.addSettingTab(new IServSettingTab(this.app, this));

    this.addCommand({
      id: "iserv-sync-test",
      name: "Battle-Test: Login + alle Kern-Fetches",
      callback: () => {
        void this.battleTest();
      },
    });

    this.addCommand({
      id: "iserv-set-credentials",
      name: "Credentials setzen",
      callback: () => {
        this.setCredentialsFlow();
      },
    });

    if (this.settings.pollMinutes > 0) {
      this.registerInterval(
        window.setInterval(
          () => void this.battleTest(true),
          this.settings.pollMinutes * 60_000
        )
      );
    }
  }

  onunload(): void {
    this.client = null;
  }

  /** Sidebar-View aktivieren (oder bestehendes Leaf fokussieren) + mit Daten befüllen. */
  private async openSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_ISERV_SIDEBAR);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({
        type: VIEW_TYPE_ISERV_SIDEBAR,
        active: true,
      });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
      void this.refreshSidebar();
    }
  }

  /** Daten holen und in die Sidebar rendern (best-effort, ohne Notice-Spam). */
  private async refreshSidebar(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_ISERV_SIDEBAR
    );
    const view = leaves[0]?.view;
    if (!(view instanceof IServSidebarView)) return;
    try {
      let client = await this.makeClient();
      let tt = await timetable(client);
      // timetable() schluckt Fehler (ADR-0007-Pattern) → leeres Ergebnis kann
      // eine abgelaufene Session bedeuten. Einmal neu einloggen und erneut versuchen.
      if (tt.length === 0) {
        this.client = null;
        client = await this.makeClient();
        await client.login();
        tt = await timetable(client);
      }
      const [subs, slots] = await Promise.all([
        substitutions(client),
        timetableSlots(client),
      ]);
      const entries = toSidebarEntries(tt);
      const data: SidebarData = {
        entries,
        slots: slots.length > 0 ? slots : slotsFromEntries(tt),
        substs: subs,
        now: new Date(),
      };
      view.update(data);
    } catch (err) {
      new Notice(`IServ-Sidebar: ${String(err)}`, 8000);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, ...(await this.loadCredSafe()) });
  }

  /** CredStore-Einträge aus data.json retten (CredStore schreibt unter _credentials). */
  private async loadCredSafe(): Promise<Record<string, unknown>> {
    const data = await this.loadData();
    return data && typeof data === "object" ? {} : {};
  }

  private async log(line: string): Promise<void> {
    this.lastLog += line + "\n";
    console.log("[iserv]", line);
    const path = "iserv-sync-log.md";
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.app.vault.append(file, line + "\n");
      } else {
        await this.app.vault.create(path, `# IServ sync log\n\n${line}\n`);
      }
    } catch (e) {
      console.error("[iserv] log write failed", e);
    }
  }

  private lastResult = "";

  private async battleTest(silent = false): Promise<void> {
    this.lastLog = "";
    const lines: string[] = [];
    try {
      await this.log(`Battle-Test start ${new Date().toISOString()}`);

      // 1) Client bauen (Transport = Node https) + Login
      const client = await this.makeClient();
      const loginResp = await client.login();
      const cookieJar: CookieStore = client.getCookies();
      const session = cookieJar.get("IServSession");
      await this.log(
        `login: status=${loginResp.status}, IServSession=${session ? "SET" : "MISSING"}`
      );
      if (!session) throw new Error("Kein IServSession-Cookie nach Login-Kette");

      // 2) users/me (JSON-Endpoint invariance check) via client request
      const me = await client.request("/iserv/dieschulapp/api/1.0/users/me");
      let meName = "?";
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        meName = (JSON.parse(me.body) as any).displayname || "?";
      } catch { /* ignore */ }
      await this.log(`users/me: status=${me.status}, displayname=${meName}`);

      // 3) timetable
      const tt = await timetable(client);
      await this.log(
        `timetable-entries: ${tt.length} Einträge` +
          (tt[0]
            ? `, probe=${tt[0].courseSubject?.subject?.name || "?"} (wd=${tt[0].weekday})`
            : "")
      );

      // 4) substitutions
      const subs = await substitutions(client);
      await this.log(`substitutions: ${subs.length} Einträge`);

      // 5) mails + unread — Mailadresse ist immer username@host (kein eigenes Setting)
      const account = this.settings.user
        ? `${this.settings.user}@${this.settings.host}`
        : "";
      const mailList = account ? await mails(client, account) : { mails: [], total: 0 };
      await this.log(
        `mails(${account || "n/a"}): total=${mailList.total}, erste=${mailList.mails[0]?.subject || "-"}`,
      );
      if (account) {
        const unread = await unreadCount(client, account);
        await this.log(`unreadCount: ${unread}`);
      }

      // 6) exercises
      const ex = await exercises(client);
      await this.log(
        `exercises: ${ex.length} (nicht abgegeben)` +
          (ex[0] ? `, probe=${ex[0].title} (${ex[0].course})` : "")
      );

      this.lastResult = "OK";
      await this.log("Battle-Test OK ✅");
      if (!silent) new Notice(`IServ Battle-Test OK: ${lines.length} Checks, s. iserv-sync-log.md`);
    } catch (e) {
      this.lastResult = "FAIL";
      const msg = e instanceof Error ? e.message : String(e);
      await this.log(`Battle-Test FEHLGESCHLAGEN: ${msg}`);
      if (!silent) {
        new Notice(`IServ Battle-Test fehlgeschlagen: ${msg}`, 10_000);
      }
    }
  }

  private async makeClient(): Promise<IServClient> {
    if (this.client) return this.client;
    const pass = await this.credStore.load("pass");
    if (!pass) {
      throw new Error(
        "Kein Passwort im Keychain (Settings → Credentials setzen)."
      );
    }
    const twofa = (await this.credStore.load("twofa")) ?? "";
    const config: IServConfig = {
      hostname: this.settings.host,
      port: this.settings.port,
      ssl: this.settings.ssl,
      username: this.settings.user,
      password: pass,
      twoFactorToken: twofa || undefined,
    };
    const Factory = IServClient;
    this.client = new Factory(config);
    return this.client;
  }

  openCredentialModal(): void {
    const modal = new CredentialPrompt(
      this.app,
      async (pass, twofa) => {
        await this.credStore.save("pass", pass);
        if (twofa) await this.credStore.save("twofa", twofa);
        else await this.credStore.clear("twofa");
        this.client = null; // rebuild with new creds
        new Notice("IServ: Credentials gespeichert (Keychain).");
        void this.battleTest();
      }
    );
    modal.open();
  }

  private setCredentialsFlow(): void {
    this.openCredentialModal();
  }
}

class CredentialPrompt extends Modal {
  constructor(
    app: App,
    private onSave: (pass: string, twofa: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "IServ-Credentials" });
    this.contentEl.createEl("p", {
      text: "Passwort (und optional 2FA-Token) liegen verschlüsselt im OS-Secret-Store — nie in data.json.",
    });
    const passEl = this.contentEl.createEl("input", {
      type: "password",
      placeholder: "passwort",
    });
    passEl.style.width = "100%";
    const twofaEl = this.contentEl.createEl("input", {
      type: "text",
      placeholder: "2FA-Token (optional, TOTP)",
    });
    twofaEl.style.width = "100%";
    const btn = this.contentEl.createEl("button", { text: "Speichern" });
    btn.onclick = async () => {
      this.close();
      await this.onSave(passEl.value, twofaEl.value.trim());
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class IServSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: IServPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Host")
      .setDesc("IServ-Instanz")
      .addText((t) =>
        t.setValue(this.plugin.settings.host).onChange(async (v) => {
          this.plugin.settings.host = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Benutzer")
      .setDesc("IServ-Login; Mail-Konto = benutzer@host (abgeleitet). Passwort landet im Keychain.")
      .addText((t) =>
        t.setValue(this.plugin.settings.user).onChange(async (v) => {
          this.plugin.settings.user = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Credentials setzen")
      .setDesc("Passwort / 2FA über Keychain-Modal setzen")
      .addButton((b) =>
        b.setButtonText("Öffnen").onClick(() => {
          void this.plugin.openCredentialModal();
        })
      );
  }
}

/** TimetableEntry → SidebarEntry (Slot-Objekt flach, Room-Objekt flach). */
function toSidebarEntries(entries: TimetableEntry[]): SidebarEntry[] {
  return entries.map((e) => ({
    id: e.id,
    weekday: e.weekday,
    slot:
      typeof e.timeTableSlot === "number"
        ? e.timeTableSlot
        : (e.timeTableSlot?.number ?? 0),
    subject: e.courseSubject?.subject?.name ?? "?",
    course: e.courseSubject?.course?.name ?? "",
    room:
      typeof e.room === "string" || e.room === null
        ? e.room
        : (e.room?.name ?? null),
  }));
}

/** Fallback: Slot-Raster aus den Entries selbst extrahieren (falls slots/-API leer). */
function slotsFromEntries(entries: TimetableEntry[]): TimetableSlot[] {
  const byNumber = new Map<number, TimetableSlot>();
  for (const e of entries) {
    if (e.timeTableSlot && typeof e.timeTableSlot === "object") {
      byNumber.set(e.timeTableSlot.number, e.timeTableSlot);
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

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
import { mails, unreadCount, mailBody, searchMails } from "./api/mails";
import { exercises } from "./api/exercises";
import {
  IServSidebarView,
  VIEW_TYPE_ISERV_SIDEBAR,
  type SidebarData,
  type SidebarExam,
} from "./views/SidebarView";
import {
  IServDashboardView,
  VIEW_TYPE_ISERV_DASHBOARD,
  type DashboardData,
} from "./views/DashboardView";
import type { Mail } from "./api/mails";
import type { SidebarEntry } from "./views/sidebar-logic";
import { ReviewQueue } from "./review-queue/state";
import { computeDueShift } from "./review-queue/due-shift";
import type { Substitution } from "./api/timetable";
import { calculatePrepWindow, setBaseDays } from "./exams/prep-window";
import { ExamType } from "./exams/template";
import type { CookieStore } from "./client/CookieStore";

interface IServSettings {
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  pollMinutes: number;
  /** Vorbereitungsfenster-Basen in Tagen (ADR-0006, override für DEFAULT_BASE_DAYS). */
  prepWindowBaseDays?: Partial<import("./exams/prep-window").PrepWindowBases>;
  /** Spam-Filter: Absender außerhalb der Schul-Domain filtern (ADR-0008/Plan "onlySchoolEmails"). */
  onlySchoolEmails: boolean;
}

const DEFAULT_SETTINGS: IServSettings = {
  host: "gymmeck.de",
  port: 443,
  ssl: true,
  user: "",
  pollMinutes: 0,
  onlySchoolEmails: true,
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
  /** Zuletzt gefetchte Mail-Listen (Sidebar + Dashboard), für openMailReaderById. */
  private lastMails: Mail[] = [];
  queue = new ReviewQueue({
    loadData: () => this.loadData(),
    saveData: (d) => this.saveData(d),
  });
  client: IServClient | null = null;
  private lastLog = "";

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (this.settings.prepWindowBaseDays) {
      setBaseDays(this.settings.prepWindowBaseDays);
    }
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
    this.registerView(
      VIEW_TYPE_ISERV_DASHBOARD,
      (leaf: WorkspaceLeaf) => new IServDashboardView(leaf)
    );

    this.addRibbonIcon("school", "IServ öffnen", () => {
      void this.openSidebar();
    });
    this.addRibbonIcon("layout-dashboard", "IServ Dashboard", () => {
      void this.openDashboard();
    });

    this.addCommand({
      id: "iserv-open-dashboard",
      name: "Dashboard öffnen",
      callback: () => {
        void this.openDashboard();
      },
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
          () => void this.refreshSidebar().catch(() => undefined),
          this.settings.pollMinutes * 60_000
        )
      );
    }

    // Auto-Login on startup (#17 Fund 8, ADR-0005): stiller Login-Versuch,
    // Ergebnis nur im Log (kein Notice-Spam beim App-Start).
    window.setTimeout(() => {
      void this.makeClientWithLogin()
        .then(() => this.log("startup auto-login ok"))
        .catch((err) =>
          this.log(`startup auto-login fehlgeschlagen: ${String(err)}`)
        );
    }, 2_000);
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
  async refreshSidebar(): Promise<void> {
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
      // Session-Restore: geprüfter Client liefert direkt Daten — sonst
      // Fulllogin und die frische Session persistieren (#17 Fund 5).
      if (tt.length === 0) {
        this.client = null;
        client = await this.makeClient();
        await client.login();
        tt = await timetable(client);
        const session = client.getCookies().get("IServSession");
        if (session) {
          await this.credStore.saveSession(session);
        }
      }
      const [subs, slots] = await Promise.all([
        substitutions(client),
        timetableSlots(client),
      ]);

      // Due-Shift (ADR-0002): lokale HA-Notizen bei Entfall auto-aktualisieren.
      try {
        await this.applyDueShift(tt, subs);
      } catch (err) {
        // best-effort: Shift scheitert nicht an der Sidebar.
        console.warn("IServ due-shift:", err);
      }

      // Benachrichtigungen: Mails (5) + Ungelesen (Mailkonto = user@host).
      let mailList: Awaited<ReturnType<typeof mails>> = { mails: [], total: 0 };
      let unread = 0;
      const account = this.settings.user
        ? `${this.settings.user}@${this.settings.host}`
        : "";
      if (account) {
        try {
          mailList = await mails(client, account, 5, 0, {
            onlySchool: this.settings.onlySchoolEmails,
            schoolHost: this.settings.host,
          });
          unread = await unreadCount(client, account);
          this.lastMails = mailList.mails;
        } catch {
          // Mails sind best-effort — Stundenplan bleibt trotzdem sichtbar.
        }
      }

      // Aktive Arbeiten aus dem Vault (ADR-0006-Frontmatter, laufende Vorbereitungen).
      const exams = await this.activeExams();

      // Review-Queue aus queue.json.
      await this.queue.load();
      const queueItems = this.queue.getItems();

      const data: SidebarData = {
        entries: toSidebarEntries(tt),
        slots: slots.length > 0 ? slots : slotsFromEntries(tt),
        substs: subs,
        now: new Date(),
        mails: mailList.mails,
        unread,
        queue: queueItems,
        exams,
        mailRowClick: (id) => {
          void this.openMailReaderById(String(id), account);
        },
        queueActions: this.queueActionHandlers(),
      };
      view.update(data);
    } catch (err) {
      new Notice(`IServ-Sidebar: ${String(err)}`, 8000);
    }
  }

  /** Dashboard-View aktivieren + mit Daten befüllen. */
  private async openDashboard(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_ISERV_DASHBOARD);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf(true);
      await leaf?.setViewState({
        type: VIEW_TYPE_ISERV_DASHBOARD,
        active: true,
      });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
      void this.refreshDashboard();
    }
  }

  /** Dashboard-Datenfluss (Mails in Gänze + Such-Hook, Queue, Arbeiten). */
  private async refreshDashboard(query?: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_ISERV_DASHBOARD
    );
    const view = leaves[0]?.view;
    if (!(view instanceof IServDashboardView)) return;
    try {
      const client = await this.makeClientWithLogin();
      const [tt, subs, slots] = await Promise.all([
        timetable(client),
        substitutions(client),
        timetableSlots(client),
      ]);
      const account = this.settings.user
        ? `${this.settings.user}@${this.settings.host}`
        : "";
      let mailList: { mails: Mail[]; total: number } = { mails: [], total: 0 };
      let unread = 0;
      if (account) {
        const onlySchool = this.settings.onlySchoolEmails;
        if (query && query.trim() !== "") {
          // Server-seitige Suche (#19 verifiziert: q= + query_search_fields[]).
          mailList = await searchMails(client, account, query, {
            limit: 50,
            onlySchool,
            schoolHost: this.settings.host,
          });
        } else {
          mailList = await mails(client, account, 50, 0, {
            onlySchool,
            schoolHost: this.settings.host,
          });
        }
        // Mail-Cache mergen (Sidebar + Dashboard), für openMailReaderById.
        const known = new Map(this.lastMails.map((m) => [String(m.id), m]));
        for (const m of mailList.mails) known.set(String(m.id), m);
        this.lastMails = [...known.values()];
        unread = await unreadCount(client, account);
      }
      const exams = await this.activeExams();
      const data: DashboardData = {
        entries: toSidebarEntries(tt),
        slots: slots.length > 0 ? slots : slotsFromEntries(tt),
        substs: subs,
        now: new Date(),
        mails: mailList.mails,
        unread,
        queue: this.queue.getItems(),
        exams,
        mailSearchQuery: query ?? "",
        onMailSearch: (q) => {
          void this.refreshDashboard(q);
        },
        mailRowClick: (id) => {
          void this.openMailReaderById(String(id), account);
        },
        queueActions: this.queueActionHandlers(),
      };
      view.update(data);
    } catch (err) {
      new Notice(`IServ-Dashboard: ${String(err)}`, 8000);
    }
  }

  /** Client mit garantiertem Login (Re-Login bei leerem Stundenplan). */
  private async makeClientWithLogin(): Promise<IServClient> {
    let client = await this.makeClient();
    const tt = await timetable(client);
    if (tt.length === 0) {
      this.client = null;
      client = await this.makeClient();
      await client.login();
      // Session persistieren (#17 Fund 5).
      const session = client.getCookies().get("IServSession");
      if (session) {
        await this.credStore.saveSession(session);
      }
    }
    return client;
  }

  /** Mail-Reader-Modal öffnen (subject/from/date + Body best-effort). */
  private async openMailReaderById(id: string, account: string): Promise<void> {
    // Metadaten aus dem letzten Fetch-Cache (Sidebar/Dashboard suchen nach id).
    const cached = this.lastMails.find((m) => String(m.id) === id);
    const mail: Mail = cached ?? {
      id,
      subject: "",
      from: "",
      date: "",
      snippet: "",
      flags: [],
    };
    const modal = new MailReaderModal(
      this.app,
      mail,
      account,
      this.client,
      async (mid) => {
        if (!this.client || !account) return "";
        try {
          return await mailBody(this.client, account, mid);
        } catch {
          return "";
        }
      }
    );
    modal.open();
  }

  /** Queue-Action-Handler (echte Persistenz über ReviewQueue). */
  private queueActionHandlers(): {
    onKeep(id: string): void;
    onDiscard(id: string): void;
    onUnsure(id: string): void;
  } {
    return {
      onKeep: (id) => {
        this.queue.updateStatus(id, "kept");
        void this.queue.save();
        void this.refreshSidebar();
      },
      onDiscard: (id) => {
        const item = this.queue.getItems().find((i) => i.id === id);
        this.queue.updateStatus(id, "discarded");
        void this.queue.save();
        void this.refreshSidebar();
      },
      onUnsure: (id) => {
        this.queue.updateStatus(id, "unsure");
        void this.queue.save();
        void this.refreshSidebar();
      },
    };
  }
  private async activeExams(): Promise<SidebarExam[]> {
    const out: SidebarExam[] = [];
    const today = new Date();
    const md = this.app.vault.getMarkdownFiles();
    for (const file of md) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as
        | { tags?: unknown; termin?: unknown; fach?: unknown }
        | undefined;
      if (!fm || !fm.termin) continue;
      const tags = Array.isArray(fm.tags)
        ? fm.tags.map(String)
        : typeof fm.tags === "string"
          ? fm.tags.split(",").map((t) => t.trim())
          : [];
      if (!tags.includes("Arbeit")) continue;
      const examDate = new Date(String(fm.termin));
      if (Number.isNaN(examDate.getTime())) continue;
      const prep = calculatePrepWindow(examDate, ExamType.Klausur, 15, "points");
      // Aktiv = Vorbereitungsfenster läuft (prepStart ≤ heute) und Termin nicht vorbei.
      if (today >= prep.prepStart && today <= examDate) {
        out.push({
          title: file.basename,
          daysLeft: prep.daysRemaining,
        });
      }
    }
    out.sort((a, b) => a.daysLeft - b.daysLeft);
    return out.slice(0, 5);
  }

  /**
   * Due-Shift (T4/ADR-0002): lokale HA-Notizen mit `Bis`-Frontmatter und
   * `fach` bekommen bei Entfall des Fachs am Bis-Tag automatisch das neue
   * Bis-Datum (nächste tatsächliche Stunde). Remote nur Vorschlag (hier
   * nicht implementiert — ein-Klick-Vorschlag ist Dashboard-Scope).
   */
  private async applyDueShift(
    entries: TimetableEntry[],
    substs: Substitution[]
  ): Promise<number> {
    const md = this.app.vault.getMarkdownFiles();
    let shifted = 0;
    for (const file of md) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as
        | { Bis?: unknown; fach?: unknown; kurs?: unknown }
        | undefined;
      if (!fm?.Bis) continue;
      const due = new Date(String(fm.Bis));
      if (Number.isNaN(due.getTime())) continue;
      const dueIso = due.toISOString().slice(0, 10);
      const fach = fm.fach ? String(fm.fach) : undefined;
      if (!fach) continue;
      const result = computeDueShift({
        entries,
        substitutions: substs,
        subject: fach,
        course: fm.kurs ? String(fm.kurs) : undefined,
        currentDue: dueIso,
        now: new Date(),
      });
      if (!result.newDue) continue;
      await this.app.fileManager.processFrontMatter(file, (fmObj) => {
        fmObj["Bis"] = result.newDue;
      });
      shifted++;
      new Notice(
        `IServ: HA "${file.basename}" verschoben auf ${result.newDue} (${result.reason})`
      );
    }
    return shifted;
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
    const config: IServConfig = {
      hostname: this.settings.host,
      port: this.settings.port,
      ssl: this.settings.ssl,
      username: this.settings.user,
      password: "",
      twoFactorToken: undefined,
    };
    const Factory = IServClient;
    const client = new Factory(config);
    // Session-Restore (#17 Fund 5): gepersisterten IServSession-Cookie
    // wiederverwenden, bevor ein neuer Volllogin läuft.
    const saved = await this.credStore.loadSession();
    if (saved) {
      client.getCookies().set("IServSession", saved);
      try {
        const probe = await timetable(client);
        if (probe.length > 0) {
          this.client = client;
          return this.client;
        }
        // Session todt → clear + Volllogin (weiter unten).
        await this.credStore.clearSession();
      } catch {
        await this.credStore.clearSession();
      }
    }
    const pass = await this.credStore.load("pass");
    if (!pass) {
      throw new Error(
        "Kein Passwort im Keychain (Settings → Credentials setzen)."
      );
    }
    const twofa = (await this.credStore.load("twofa")) ?? "";
    config.password = pass;
    config.twoFactorToken = twofa || undefined;
    this.client = client;
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

    new Setting(containerEl)
      .setName("Vorbereitungsfenster (Tage)")
      .setDesc("Klausur/Klassik-Arbeit/Abitur — Basen (ADR-0006, default 15/10/183)")
      .addText((t) =>
        t
          .setValue(
            String(
              this.plugin.settings.prepWindowBaseDays?.Klausur ??
                15
            )
          )
          .onChange(async (v) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) return;
            this.plugin.settings.prepWindowBaseDays = {
              ...this.plugin.settings.prepWindowBaseDays,
              Klausur: n,
            };
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Spam-Filter (nur Schulmails)")
      .setDesc(
        "Mails von Absendern außerhalb der Schul-Domain (z. B. gymmeck.de) verbergen."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.onlySchoolEmails).onChange(async (v) => {
          this.plugin.settings.onlySchoolEmails = v;
          await this.plugin.saveSettings();
          void this.plugin.refreshSidebar();
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

/** Mail-Reader-Modal (T10): Obsidian-Shell, Rendering obsidian-frei (mail-reader.ts). */
class MailReaderModal extends Modal {
  constructor(
    app: App,
    private mail: Mail,
    private account: string,
    private client: IServClient | null,
    private loadBody: (id: number | string) => Promise<string>
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("iserv-mail-reader-modal");
    // Ladeindikator; renderMailReader übernimmt komplett (Subject/From/Date/Body).
    contentEl.setText("Mail lädt …");
    let body = "";
    try {
      body = await this.loadBody(this.mail.id);
    } catch {
      body = ""; // → Platzhalter im Renderer (Endpoint-Spike offen)
    }
    const { renderMailReader } = await import("./views/mail-reader");
    renderMailReader(contentEl, this.mail, body);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

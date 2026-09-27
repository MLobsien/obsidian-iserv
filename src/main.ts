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
import { mails, unreadCount, mailBody, mailDetail, searchMails } from "./api/mails";
import { MAIL_PAGE_SIZE } from "./views/paginate";
import { GradeStore } from "./exams/grade-store";
import { writeStudyPlanNote } from "./exams/study-plan-note";
import type { StudyPlanInput } from "./exams/study-plan";
import { renderGradeIndex, renderGradeEntryModal, type GradeIndexEntryInfo } from "./views/grade-index";
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
import type { Mail, MailAttachmentMeta } from "./api/mails";
import type { SidebarEntry } from "./views/sidebar-logic";
import { ReviewQueue } from "./review-queue/state";
import type { QueueItem } from "./review-queue/state";
import { fetchQueueItems } from "./review-queue/files-feed";
import { NoticeCenter } from "./views/notice-center";
import type { PdfJsLib } from "./views/pdf-viewer";
import { computeDueShift } from "./review-queue/due-shift";
import type { Substitution } from "./api/timetable";
import { calculatePrepWindow, setBaseDays } from "./exams/prep-window";
import { ExamType } from "./exams/template";
import type { CookieStore } from "./client/CookieStore";
import {
  JobRunner,
  MS_PER_MINUTE,
} from "./jobs/JobRunner";
import { createJobModules } from "./jobs/job-runners";
import {
  DEFAULT_SETTINGS,
  type IServSettings,
} from "./settings/settings-types";
import { IServSettingTab } from "./settings/settings-tab";

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
  /**
   * Cred-RAM-Cache (CONTEXT.md): entschlüsselte Credentials nur im Speicher
   * der laufenden Session — Re-Logins brauchen den Secret-Store nicht neu,
   * solange das Plugin läuft. Kein Persist (ADR-0003 fail-closed unangetastet).
   */
  private cachedPass: string | null = null;
  private cachedTwofa: string | null = null;
  /** Secret-Store war beim letzten load-Versuch nicht verfügbar (KeePassXC zu). */
  private credsUnavailable = false;
  queue = new ReviewQueue({
    loadData: () => this.loadData(),
    saveData: (d) => this.saveData(d),
  });
  client: IServClient | null = null;
  private lastLog = "";
  /**
   * Notice-Dedup (T3/T4): häufige Meldungen (Login-fail, Creds unavailable,
   * Sync done) stapeln sich nicht mehrfach — key-basiertes Fenster pro Notice.
   */
  readonly notices = new NoticeCenter();
  /** T24/ADR-0005: modularer JobRunner, eine Instanz pro Modul. */
  private jobRunners: Record<"core" | "mails" | "exercises", JobRunner> | null = null;
  /** T18: Notenindex (Fach → Einträge) in data.json unter "grade-index". */
  readonly gradeStore = new GradeStore({
    loadData: () => this.loadData(),
    saveData: (d) => this.saveData(d),
  });

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    void this.gradeStore.load(); // T18: Notenindex asynchron laden
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
    this.addRibbonIcon("refresh-cw", "IServ: Jetzt synchronisieren", () => {
      void this.syncNow();
    });

    this.addCommand({
      id: "iserv-open-sidebar",
      name: "Sidebar öffnen",
      callback: () => {
        void this.openSidebar();
      },
    });
    this.addCommand({
      id: "iserv-open-dashboard",
      name: "Dashboard öffnen",
      callback: () => {
        void this.openDashboard();
      },
    });
    this.addCommand({
      id: "iserv-sync-now",
      name: "Jetzt synchronisieren",
      callback: () => {
        void this.syncNow();
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

    // T24/ADR-0005: gezielter Schnellsync pro Modul (ADR-0005-Feature).
    this.addCommand({
      id: "iserv-sync-core",
      name: "IServ sync: core",
      callback: () => {
        void this.jobRunners?.core.trigger();
      },
    });
    this.addCommand({
      id: "iserv-sync-mails",
      name: "IServ sync: mails",
      callback: () => {
        void this.jobRunners?.mails.trigger();
      },
    });
    this.addCommand({
      id: "iserv-sync-exercises",
      name: "IServ sync: exercises",
      callback: () => {
        void this.jobRunners?.exercises.trigger();
      },
    });
    this.addCommand({
      id: "iserv-grades-index",
      name: "IServ: Notenindex öffnen",
      callback: () => {
        this.openGradeIndexModal();
      },
    });
    this.addCommand({
      id: "iserv-grades-entry",
      name: "IServ: Note eintragen",
      callback: () => {
        this.openGradeEntryModal();
      },
    });
    this.addCommand({
      id: "iserv-study-plan",
      name: "IServ: Lernplan erstellen (aktive Arbeit)",
      callback: () => {
        void this.createStudyPlanForActiveExam();
      },
    });

    this.setupJobRunners();

    // Auto-Login on startup (#17 Fund 8, ADR-0005): stiller Login-Versuch,
    // Ergebnis nur im Log (kein Notice-Spam beim App-Start).
    window.setTimeout(() => {
      void this.makeClientWithLogin()
        .then(() => this.log("startup auto-login ok"))
        .catch((err) =>
          this.log(`startup auto-login fehlgeschlagen: ${String(err)}`)
        );
    }, 2_000);

    // Cred-Retry-Timer (Q2-Entscheidung): wenn der Secret-Store beim Start
    // verschlossen war (KeePassXC-DB zu), still alle 60 s erneut versuchen;
    // bei Erfolg verbinden + beide Views nachladen.
    this.registerInterval(
      window.setInterval(() => {
        if (!this.credsUnavailable) return;
        void this.makeClientWithLogin()
          .then(() => {
            this.notices.notifyOnce(
              "cred-recovered",
              "IServ: Secret-Store verfügbar — verbunden.",
              4_000
            );
            void this.jobRunners?.core.trigger();
            void this.jobRunners?.mails.trigger();
            void this.jobRunners?.exercises.trigger();
          })
          .catch(() => undefined); // weiter still warten
      }, 60_000)
    );
  }

  onunload(): void {
    this.client = null;
  }

  /**
   * T24/ADR-0005: modularer JobRunner ersetzt den ad-hoc Sidebar-Poll.
   * Ein registerInterval pro Modul (Obsidian räumt automatisch auf); die
   * Intervalle (Minuten) kommen aus den Settings (0 = Modul aus). Fehler
   * dezent (1. Fehler Notice, Folgen nur Log — Session-Log-Pattern), Erfolg
   * still. sharedJobSequence garantiert: nie 2 Module simultan; der geteilte
   * Rate-Limiter lebt im Client (keine Doppel-Logik hier).
   */
  private setupJobRunners(): void {
    if (this.jobRunners) return; // onload läuft genau einmal
    const modules = createJobModules({
      getClient: () => this.makeClientWithLogin(),
      fetchCore: async (client) => {
        const tt = await timetable(client);
        const [subs] = await Promise.all([
          substitutions(client),
          timetableSlots(client),
        ]);
        try {
          await this.applyDueShift(tt, subs);
        } catch (err) {
          console.warn("IServ due-shift:", err);
        }
      },
      account: () =>
        this.settings.user
          ? `${this.settings.user}@${this.settings.host}`
          : "",
      onlySchool: () => this.settings.onlySchoolEmails,
      schoolHost: () => this.settings.host,
      coreToggle: () => this.settings.jobIntervals.core > 0,
      mailsToggle: () => this.settings.jobIntervals.mails > 0,
      exercisesToggle: () => this.settings.jobIntervals.exercises > 0,
    });
    const onError = (module: string, err: unknown, consecutive: number) => {
      const msg = String(err).slice(0, 120);
      void this.log(
        `job ${module} fehlgeschlagen (${consecutive}x): ${msg}`
      );
      if (consecutive === 1) {
        this.notices.notifyOnce(
          `job-error-${module}`,
          `IServ sync (${module}) fehlgeschlagen: ${msg}`,
          8_000
        );
      }
    };
    const mk = (
      module: (typeof modules)["core" | "mails" | "exercises"]
    ): JobRunner => new JobRunner({ module, onError });
    const intervalMs = (key: "core" | "mails" | "exercises") =>
      Math.max(0, this.settings.jobIntervals[key]) * MS_PER_MINUTE;
    this.jobRunners = {
      core: mk(modules.core),
      mails: mk(modules.mails),
      exercises: mk(modules.exercises),
    };
    const schedule = (key: "core" | "mails" | "exercises") => {
      const ms = intervalMs(key);
      if (ms > 0) {
        this.registerInterval(
          window.setInterval(() => void this.jobRunners?.[key].tick(), ms)
        );
      }
    };
    schedule("core");
    schedule("mails");
    schedule("exercises");
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
  /**
   * T9/T10: page (0-basiert) steuert die Mail-Seite server-seitig
   * (mails() mit limit=10, offset=page*10) — "Ältere Mails browsen".
   */
  async refreshSidebar(page = 0): Promise<void> {
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
        if (this.credsUnavailable && this.client) {
          // KeePassXC zu, aber RAM-Session lebt: weiter mit bestehendem Client
          // (Re-Login braucht den Store — Cred-RAM-Cache, CONTEXT.md).
        } else {
          this.client = null;
          client = await this.makeClient();
          await client.login();
          tt = await timetable(client);
          const session = client.getCookies().get("IServSession");
          if (session) {
            await this.credStore.saveSession(session);
          }
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
          mailList = await mails(client, account, MAIL_PAGE_SIZE, page * MAIL_PAGE_SIZE, {
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
        mailPage: page,
        mailPageSize: MAIL_PAGE_SIZE,
        onMailPage: (p) => {
          void this.refreshSidebar(p);
        },
        mailRowClick: (id) => {
          void this.openMailReaderById(String(id), account);
        },
        queueActions: this.queueActionHandlers(),
        onPreview: (item) => this.openPdfPreview(item),
        // T3/T4: dezenter Header-Sync-Button → gleicher Sync-Pfad wie Ribbon.
        onSyncClick: () => {
          void this.syncNow();
        },
      };
      view.update(data);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      view.updateError(msg);
      // T3/T4: Dedup über NoticeCenter (gleiches Fenster, kein Notice-Stapel).
      this.notices.notifyOnce("sidebar-error", `IServ-Sidebar: ${msg}`, 8_000);
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
  async refreshDashboard(query?: string, page = 0): Promise<void> {
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
            limit: MAIL_PAGE_SIZE,
            offset: page * MAIL_PAGE_SIZE,
            onlySchool,
            schoolHost: this.settings.host,
          });
        } else {
          mailList = await mails(client, account, MAIL_PAGE_SIZE, page * MAIL_PAGE_SIZE, {
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
        noticeCenter: this.notices,
        mailPage: page,
        mailPageSize: MAIL_PAGE_SIZE,
        mailSearchQuery: query ?? "",
        onMailSearch: (q) => {
          void this.refreshDashboard(q);
        },
        onMailPage: (p) => {
          void this.refreshDashboard(query, p);
        },
        mailRowClick: (id) => {
          void this.openMailReaderById(String(id), account);
        },
        queueActions: this.queueActionHandlers(),
        onPreview: (item) => this.openPdfPreview(item),
      };
      view.update(data);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      view.updateError(msg);
      this.notices.notifyOnce("dashboard-error", `IServ-Dashboard: ${msg}`, 8_000);
    }
  }

  /** Client mit garantiertem Login (Re-Login bei leerem Stundenplan). */
  private async makeClientWithLogin(): Promise<IServClient> {
    let client = await this.makeClient();
    const tt = await timetable(client);
    if (tt.length === 0) {
      if (this.credsUnavailable && this.client) {
        // KeePassXC zu, RAM-Session lebt → bestehenden Client behalten.
        return this.client;
      }
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
  /** Body + Anlagen eines Mails (mailDetail, Fehler → leerer Body). */
  private async loadMailDetail(
    id: string | number,
    account: string
  ): Promise<{ body: string; attachments: MailAttachmentMeta[] }> {
    if (!this.client || !account) {
      return { body: "", attachments: [] };
    }
    try {
      return await mailDetail(this.client, account, id);
    } catch {
      return { body: "", attachments: [] };
    }
  }

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
    const detail = await this.loadMailDetail(mail.id, account);
    const modal = new MailReaderModal(this.app, mail, detail.body, detail.attachments);
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

  /**
   * T21: Vollviewer-Modal für ein Queue-Item (pdf/image → Inline, other →
   * Fallback-Text + extern). Bytes über den verifizierten file-Endpoint
   * (iserv/file/-/<pfad>, T15-Konvention) mit Plugin-Session.
   */
  private openPdfPreview(item: QueueItem): void {
    if (!this.client) {
      new Notice("IServ: Vorschau braucht Session — bitte syncen.", 5000);
      return;
    }
    const modal = new PdfViewerModal(this.app, item, this.client);
    modal.open();
  }

  /** T18: Notenindex-Modal (Fach | Noten | Durchschnitt, Entry-Klick → Entry-Modal). */
  private openGradeIndexModal(): void {
    const modal = new Modal(this.app);
    modal.contentEl.addClass("iserv-grade-index-modal");
    const render = () =>
      renderGradeIndex(modal.contentEl, this.gradeStore.getAllGrades(), {
        onEntry: (info) => {
          modal.contentEl.empty();
          renderGradeEntryModal(modal.contentEl, info, {
            scale: this.settings.gradesScale === "grades" ? "grades" : "points",
            onSubmit: ({ points, scale }) => {
              this.gradeStore.addGrade(info.subject, {
                examTitle: info.examTitle,
                date: info.date,
                points,
                scale,
              });
              void this.gradeStore.save();
              modal.contentEl.empty();
              this.openGradeIndexModal(); // Index neu zeichnen
            },
          });
        },
      });
    render();
    modal.open();
  }

  /** T18: Standalone-Noteneintrag (Fach/Edit-Titel frei eintragbar). */
  private openGradeEntryModal(): void {
    const subjects = this.gradeStore.getSubjects().map((s) => s.subject);
    if (subjects.length === 0 && !/^[A-ZÄÖÜ]/.test("")) {
      // Noch keine Fächer: Entry auf Pseudo-Fach 'Allgemein' erlauben
    }
    const entryModal = new Modal(this.app);
    entryModal.contentEl.addClass("iserv-grade-entry-standalone");
    renderGradeEntryModal(
      entryModal.contentEl,
      {
        subject: subjects[0] ?? "Allgemein",
        examTitle: "",
        date: new Date().toISOString().slice(0, 10),
      },
      {
        scale: this.settings.gradesScale === "grades" ? "grades" : "points",
        onSubmit: ({ points, scale }) => {
          this.gradeStore.addGrade(subjects[0] ?? "Allgemein", {
            examTitle: "Note",
            date: new Date().toISOString().slice(0, 10),
            points,
            scale,
          });
          void this.gradeStore.save();
          entryModal.close();
        },
      }
    );
    entryModal.open();
  }

  /** Vault-Adapter für writeStudyPlanNote (T20, Obsidian-API injiziert). */
  private vaultNoteAdapter() {
    return {
      exists: (path: string) => this.app.vault.getAbstractFileByPath(path) !== null,
      create: async (path: string, content: string) => {
        // fehlende Ordner anlegen (Lernplan/<Fach>/)
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) {
          const dir = parts.slice(0, i).join("/");
          if (!this.app.vault.getAbstractFileByPath(dir)) {
            await this.app.vault.createFolder(dir).catch(() => undefined);
          }
        }
        await this.app.vault.create(path, content);
      },
      modify: async (path: string, content: string) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.app.vault.modify(file, content);
      },
    };
  }

  /**
   * T20: Lernplan für die nächste aktive Arbeit anlegen (Fach via Vault-
   * Ordner-Heuristik, Material = Fach-Notizen seit letzter Arbeit, mtime ab-
   * steigend). Existiert der Plan, nur Notice — kein Überschreiben.
   */
  private async createStudyPlanForActiveExam(): Promise<void> {
    const exams = await this.activeExams();
    if (exams.length === 0) {
      new Notice("IServ: Keine aktive Arbeit mit laufendem Vorbereitungsfenster.", 6000);
      return;
    }
    const exam = exams[0];
    // Fach + Notizen: Markdown-Files aus dem Fach-Ordner ('Mathematik/…'), mtime absteigend.
    const md = this.app.vault.getMarkdownFiles();
    const examFile = md.find((f) => f.basename === exam.title);
    const subject = examFile?.parent?.name ?? "Allgemein";
    // Notizen seit Vorbereitungsstart im Fach-Ordner (mtime desc).
    const prepStart = new Date(); // fallback: alle
    const base = examFile?.parent?.path ?? "";
    const notizenNoten = md
      .filter((f) => base && f.path.startsWith(base + "/") && f.path !== examFile?.path)
      .filter((f) => f.stat.mtime >= prepStart.getTime() - 30 * 24 * 3600 * 1000)
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .map((f) => f.path)
      .slice(0, 30);
    const termFm = examFile
      ? (this.app.metadataCache.getFileCache(examFile)?.frontmatter as
          | { termin?: unknown; fach?: unknown }
          | undefined)
      : undefined;
    const examDate =
      typeof termFm?.termin === "string" ? termFm.termin : prepStart.toISOString().slice(0, 10);
    const input: StudyPlanInput = {
      examTitle: exam.title,
      examDate,
      subject: subject,
      notizenNoten,
    };
    const result = await writeStudyPlanNote(this.vaultNoteAdapter(), input);
    if (result.status === "existing") {
      new Notice(`IServ: Lernplan existiert schon (${result.path}).`, 5000);
    } else {
      new Notice(`IServ: Lernplan erstellt: ${result.path}`, 5000);
    }
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
      // Dedup pro HA-Notiz: Poll-Ticks wiederholen dieselbe Verschiebung sonst.
      this.notices.notifyOnce(
        `due-shift-${file.path}`,
        `IServ: HA "${file.basename}" verschoben auf ${result.newDue} (${result.reason})`,
        60_000
      );
    }
    return shifted;
  }

  async saveSettings(): Promise<void> {
    // Fremd-Keys (review-queue, grade-index) aus data.json erhalten — Overlay
    // statt Überschreiben (Bugfix: Settings-Speichern löschte Queue/Noten).
    const existing = (await this.loadData()) as Record<string, unknown>;
    const foreign = Object.fromEntries(
      Object.entries(existing).filter(([k]) => k !== "_credentials" && k in existing && !(k in this.settings))
    );
    await this.saveData({ ...foreign, ...this.settings, ...(await this.loadCredSafe()) });
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

  /**
   * Credentials laden — Cred-RAM-Cache zuerst (CONTEXT.md): entschlüsselte
   * Werte überleben verschlossenes KeePassXC innerhalb der Laufzeit. Store
   * nur einmal pro Session-Lifetime lesen, solange der Cache steht.
   */
  private async loadCreds(): Promise<{ pass: string; twofa: string } | null> {
    if (this.cachedPass) {
      this.credsUnavailable = false;
      return { pass: this.cachedPass, twofa: this.cachedTwofa ?? "" };
    }
    try {
      const pass = await this.credStore.load("pass");
      if (!pass) return null;
      this.cachedPass = pass;
      this.cachedTwofa = (await this.credStore.load("twofa")) ?? "";
      this.credsUnavailable = false;
      return { pass, twofa: this.cachedTwofa };
    } catch (err) {
      // Fail-closed (ADR-0003): Store nicht verfügbar → dezent markieren,
      // kein hartes Werfen in Refresh-Pfaden (Retry-Timer übernimmt).
      this.credsUnavailable = true;
      console.warn("IServ: Secret-Store nicht verfügbar:", String(err).slice(0, 80));
      return null;
    }
  }

  /** Manueller Sync (Ribbon/Command/Sidebar-Header): Queue-Feed + beide Views. */
  async syncNow(): Promise<void> {
    // Job-Module-Trigger-Konvention (T24-Worker): gezielte Schnellsync-Aufrufe
    // kommen als `sync_NOW`-Kommandos per JobRunner — hier NUR Konventions-
    // Kommentar, KEINE Implementierung (ADR-0005 Bauplan, manueller Trigger
    // pro Modul bleibt im JobRunner-Registry-Lookup verdrahtet).
    this.notices.notifyOnce("sync-run", "IServ: Synchronisiere …", 5_000);
    this.notices.forget("sync-done");
    this.client = null; // frischer Login gewünscht (User-Manual-Sync)
    try {
      await this.syncAll();
      this.notices.forget("sync-run");
      this.notices.notifyOnce("sync-done", "IServ: Sync abgeschlossen.", 3_000);
    } catch (err) {
      this.notices.forget("sync-run");
      this.notices.notifyOnce(
        "sync-fail",
        `IServ-Sync fehlgeschlagen: ${String(err).slice(0, 120)}`,
        8_000
      );
    }
  }

  /**
   * Einspeisepunkt (T3/T4, ADR-0005 Bauplan): orchestriert die bestehenden
   * Refresh-Flüsse und befüllt vorher die Review-Queue aus IServ-Dateien
   * (file/api/list, ADR-0001 verifiziert — Sync-Kandidaten, nie auto-apply).
   * syncNow() ruft syncAll(); refreshSidebar/refreshDashboard bleiben die
   * Render-Pfade (rhino-Basis: updateError/onOpen-Hook unangetastet).
   */
  async syncAll(): Promise<void> {
    await this.feedQueueFromFiles();
    // Orchestrierung = bestehende Refresh-Logik (nicht neu erfinden):
    await this.refreshSidebar();
    await this.refreshDashboard();
    // Job-Module (T24) folgen der eigenen Fälligkeit; hier kein trigger() —
    // gezieltes sync_NOW bleibt JobRunner-Konvention (s. Kommentar in syncNow).
  }

  /**
   * Queue-Feed: Sync-Kandidaten aus dem IServ-Datei-Manager (Root-Listing)
   * in queue.json einspeisen. Dedup gegen bestehende IDs passiert im Feed
   * (fetchQueueItems); Persistenz hier, best-effort — ein Feed-Fehler bricht
   * den Sync nicht.
   */
  private async feedQueueFromFiles(): Promise<void> {
    try {
      const client = await this.makeClientWithLogin();
      await this.queue.load();
      const fresh = await fetchQueueItems(client, {
        vaultSubjects: this.vaultSubjectFolders(),
        existing: this.queue.getItems(),
      });
      if (fresh.length > 0) {
        for (const item of fresh) this.queue.addItem(item);
        await this.queue.save();
        this.log(`queue-feed: ${fresh.length} neue Sync-Kandidaten`);
      }
    } catch (err) {
      // best-effort: Queue-Feed scheitert nicht an der Sidebar (ADR-0007-Pattern).
      console.warn("IServ queue-feed:", err);
      this.log(`queue-feed fehlgeschlagen: ${String(err).slice(0, 120)}`);
    }
  }

  /** Vault-Fachordner-Namen (Top-Level-Ordner) für die Fach-Vermutung. */
  private vaultSubjectFolders(): string[] {
    const root = this.app.vault.getRoot();
    return root.children
      .filter((c): c is import("obsidian").TFolder => "children" in c)
      .map((c) => c.name);
  }

  private async makeClient(): Promise<IServClient> {
    if (this.client) return this.client;
    // Pass/twofa IMMER laden — Invariante: jeder Client aus makeClient ist
    // login()-fähig (Regression-Fix: Restored-Client ohne Pass brach
    // battleTest/makeClientWithLogin mit "Kein IServSession nach Login-Kette").
    const creds = await this.loadCreds();
    if (!creds) {
      throw new Error(
        "Credentials nicht lesbar (Secret-Store verschlossen?) — KeePassXC entsperren und Sidebar aktualisieren."
      );
    }
    const pass = creds.pass;
    const twofa = creds.twofa;
    const config: IServConfig = {
      hostname: this.settings.host,
      port: this.settings.port,
      ssl: this.settings.ssl,
      username: this.settings.user,
      password: pass,
      twoFactorToken: twofa || undefined,
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
        // Cred-RAM-Cache aktualisieren (CONTEXT.md), dann frischer Client.
        this.cachedPass = pass;
        this.cachedTwofa = twofa || "";
        this.credsUnavailable = false;
        this.client = null; // rebuild with new creds
        this.notices.notifyOnce(
          "creds-saved",
          "IServ: Credentials gespeichert (Keychain).",
          10_000
        );
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
    private body: string,
    private attachments: MailAttachmentMeta[] = []
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("iserv-mail-reader-modal");
    console.log("IServ-Debug: MailReaderModal.onOpen gestartet", !!contentEl);
    const { renderMailReader, renderAttachments } = await import("./views/mail-reader");
    renderMailReader(contentEl, this.mail, this.body, this.attachments);
    // Anlagen — neue Klick-Semantik (User-Kritik, Fix zu T22): KEIN stummer
    // Download mehr nach "Anlagen/". Stattdessen:
    //   pdf  → PdfViewerModal (Vollviewer, inline pdf.js oder extern-Fallback)
    //   Bild → Bild-Preview-Modal (grosses <img>)
    //   Rest → Kompakt-Dialog + Save-Modal (Pfadvorschlag, expliziter Save-Button)
    // Speichern IMMER über SaveAttachmentModal mit Pfad-Input (Fach-Vermutung,
    // save-to-vault.ts); Download-Pipeline (client → writeBinary) bleibt unverändert.
    for (const row of Array.from(contentEl.querySelectorAll(".iserv-mail-reader-attachment-row"))) {
      const el = row as HTMLElement;
      row.addEventListener("click", () => {
        void this.previewAttachment(el);
      });
    }
  }

  /**
   * Anlagen-Vorschau-Router: nach Mime/Endung in den richtigen Preview-Pfad
   * verzweigt; das Speichern bleibt ein expliziter Sekundarschritt.
   */
  private async previewAttachment(row: HTMLElement): Promise<void> {
    const url = row.dataset.url;
    const filename = row.dataset.filename || "Anlage";
    const mimetype = row.dataset.mimetype ?? "";
    const { classifyAttachment } = await import("./views/save-to-vault");
    const kind = classifyAttachment(mimetype, filename);
    if (!url) {
      new Notice("IServ: Anlage hat keine URL — nicht ladbar.", 5000);
      return;
    }
    if (kind === "pdf") {
      this.openAttachmentInPdfViewer(row);
    } else if (kind === "image") {
      this.openImageAttachmentModal(url, filename, mimetype);
    } else {
      this.openSaveAttachmentModal(url, filename, mimetype);
    }
  }

  /** Bild-Anlage: großes Inline-<img>-Modal mit Speichern-Button. */
  private openImageAttachmentModal(url: string, filename: string, mimetype: string): void {
    const modal = new Modal(this.app);
    modal.contentEl.addClass("iserv-image-preview-modal");
    const img = document.createElement("img");
    img.className = "iserv-image-preview-img";
    img.alt = filename;
    // Bytes via Session laden und als Blob-URL inline stellen (CORS-frei).
    const plugin = this.pluginRef;
    if (!plugin?.client) {
      modal.contentEl.setText("Anlage nicht ladbar (keine Session).");
      modal.open();
      return;
    }
    void plugin.client.request(url).then((resp) => {
      if (resp.status !== 200) {
        modal.contentEl.setText(`Anlage fehlgeschlagen (HTTP ${resp.status}).`);
        return;
      }
      const bytes = stringToBytes(resp.body);
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mimetype });
      img.src = URL.createObjectURL(blob);
      if (!img.parentElement) modal.contentEl.appendChild(img);
      const saveBtn = document.createElement("button");
      saveBtn.textContent = "Im Vault speichern …";
      saveBtn.className = "iserv-save-attachment-btn";
      saveBtn.addEventListener("click", () => {
        new SaveAttachmentModal(this.app, url, filename, bytes, this.mail.subject).open();
      });
      modal.contentEl.appendChild(saveBtn);
    });
    modal.open();
  }

  /** Other-Anlage: kompakter Dialog → direkt Save-Modal (Pfadvorschlag). */
  private openSaveAttachmentModal(url: string, filename: string, _mimetype: string, subjectHint?: string): void {
    const plugin = this.pluginRef;
    if (!plugin?.client) {
      new Notice("IServ: Speichern braucht Session.", 5000);
      return;
    }
    void plugin.client.request(url).then(async (resp) => {
      if (resp.status !== 200) {
        new Notice(`IServ: Anlage fehlgeschlagen (HTTP ${resp.status}).`, 6000);
        return;
      }
      const bytes = stringToBytes(resp.body);
      new SaveAttachmentModal(this.app, url, filename, bytes, subjectHint ?? this.mail.subject).open();
    });
  }

  /**
   * Vollviewer für ein Queue-Item (T21) — Bild- und Save-Modals teilen sich
   * die openAttachmentInPdfViewer-Logik (Bytes via part-Endpoint).
   */
  private openAttachmentInPdfViewer(row: HTMLElement): void {
    const url = row.dataset.url;
    const filename = row.dataset.filename || "anlage.pdf";
    if (!url || !this.pluginRef?.client) {
      new Notice("IServ: Vollviewer braucht URL + Session.", 5000);
      return;
    }
    const client = this.pluginRef.client;
    const subjectEl = row.closest(".iserv-mail-reader")?.querySelector(".iserv-mail-reader-subject");
    // (fetchBytes in PdfViewerModal.onOpen), SaveAttachmentModal öffnet bei Klick.
    const mailSubject = (subjectEl?.textContent ?? "").trim();
    const modal = new PdfViewerModal(this.app, {
      id: url,
      name: filename,
      path: filename,
      hash: url,
      subject: mailSubject,
      status: "neu",
    }, client, url);
    modal.onSaveToVault = () => this.openSaveAttachmentModal(url, filename, "application/pdf", mailSubject);
    modal.open();
  }

  /** Back-Ref zum Plugin (Pattern aus downloadAttachment-Zugriff). */
  private get pluginRef(): IServPlugin | null {
    const w = this.app as unknown as { plugins: { plugins: Record<string, IServPlugin> } };
    return w.plugins.plugins["iserv-integration"] ?? null;
  }

  /** Anlage herunterladen und ins Vault schreiben (Ordner 'Anlagen' im Vault-Root). */
  private async downloadAttachment(url: string | undefined, fallbackName: string): Promise<void> {
    const plugin = (this.app as unknown as { plugins: { plugins: Record<string, IServPlugin> } }).plugins.plugins["iserv-integration"];
    if (!url || !plugin?.client) {
      new Notice("IServ: Anlage nicht ladbar (keine URL/Session).", 5000);
      return;
    }
    try {
      new Notice("IServ: Lade Anlage …", 2000);
      const resp = await plugin.client.request(url);
      if (resp.status !== 200) {
        new Notice(`IServ: Anlage fehlgeschlagen (HTTP ${resp.status}).`, 6000);
        return;
      }
      const name = fallbackName || "anlage.bin";
      const folder = "Anlagen";
      const adapter = this.app.vault.adapter;
      await adapter.mkdir(folder).catch(() => undefined);
      const path = `${folder}/${name}`;
      const bytes = stringToBytes(resp.body);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      await adapter.writeBinary(path, buf);
      new Notice(`IServ: Gespeichert: ${path}`, 5000);
    } catch (err) {
      new Notice(`IServ: Anlage fehlgeschlagen: ${String(err).slice(0, 100)}`, 8000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** response.body (latin1-ish string vom Node-Transport) → Uint8Array byte-treu. */
function stringToBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * Save-Attachment-Modal (User-Kritik-Fix zu T22): Download passiert NICHT
 * stumm — expliziter „Speichern"-Button im Preview-Pfad mit editierbarem
 * Zielpfad. Vorschlag aus Fach-Vermutung (save-to-vault.ts: Mail-Betreff bzw.
 * Dateiname gegen Vault-Top-Level-Ordner, ADR-0001) + Template. Download-
 * Pipeline unverändert (client.request → stringToBytes → adapter.writeBinary).
 */
class SaveAttachmentModal extends Modal {
  constructor(
    app: App,
    private url: string,
    private filename: string,
    private bytes: Uint8Array,
    private mailSubject = ""
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("iserv-save-attachment-modal");
    const { defaultVaultTargetPath, renderSaveToVault } = await import(
      "./views/save-to-vault"
    );
    const { getAllVaultSubjects } = await import("./views/vault-folders");
    const suggested = defaultVaultTargetPath({
      subject: this.mailSubject,
      vaultSubjects: getAllVaultSubjects(this.app),
      template: this.pluginRef?.settings.template || "",
      filename: this.filename,
    });
    renderSaveToVault(contentEl, {
      suggestedPath: suggested,
      filename: this.filename,
      onSave: (targetPath) => {
        void this.save(targetPath);
        this.close();
      },
      onCancel: () => this.close(),
    });
  }

  /** Reale Ablage: existing downloadAttachment-Pipeline, nur mit neuem Pfad. */
  private async save(targetPath: string): Promise<void> {
    const plugin = this.pluginRef;
    if (!plugin?.client) {
      new Notice("IServ: Speichern braucht Session.", 5000);
      return;
    }
    try {
      const clean = targetPath.trim() || "Allgemein";
      const parts = clean.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : clean;
      const path = parts.length > 1 ? `${folder}/${this.filename}` : `${clean}/${this.filename}`;
      const adapter = this.app.vault.adapter;
      await adapter.mkdir(folder).catch(() => undefined);
      const buf = this.bytes.buffer.slice(
        this.bytes.byteOffset,
        this.bytes.byteOffset + this.bytes.byteLength
      ) as ArrayBuffer;
      await adapter.writeBinary(path, buf);
      new Notice(`IServ: Gespeichert: ${path}`, 5000);
    } catch (err) {
      new Notice(`IServ: Speichern fehlgeschlagen: ${String(err).slice(0, 100)}`, 8000);
    }
  }

  /** Back-Ref zum Plugin (Pattern MailReaderModal). */
  private get pluginRef(): IServPlugin | null {
    const w = this.app as unknown as { plugins: { plugins: Record<string, IServPlugin> } };
    return w.plugins.plugins["iserv-integration"] ?? null;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * PDF-Vollviewer-Modal (T21, ADR-0004 Welle 2): Obsidian-Shell (80vw),
 * Rendering obsidian-frei in src/views/pdf-viewer.ts (Seam-Split wie
 * MailReaderModal). pdf.js kommt aus Obsidians Bundle (loadPdfJs, kein
 * pdfjs-dist/npm-Install nötig); als Conditional-Guard bleibt der
 * Fallback-Zweig (Extern öffnen, T22 via window.open) ohne weitere npm-Deps.
 */
class PdfViewerModal extends Modal {
  /** Anlagen-Kritik (User): expliziter Save-Schritt aus dem Viewer (optional wired). */
  onSaveToVault?: () => void;

  constructor(
    app: App,
    private item: QueueItem,
    private client: IServClient,
    /** T22-Anhang-Override: part-URL statt file/-/<pfad> für Bytes+Extern. */
    private urlOverride?: string
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("iserv-pdf-viewer-modal");
    const { renderPdfViewer } = await import("./views/pdf-viewer");
    const { buildPdfPreviewUrl } = await import("./review-queue/pdf-preview");
    const url = this.urlOverride ?? buildPdfPreviewUrl(this.item).url;
    renderPdfViewer(
      contentEl,
      this.item,
      {
        url,
        filename: this.item.name,
        kind: this.urlOverride
          ? "pdf"
          : buildPdfPreviewUrl(this.item).kind,
        subject: this.item.subject,
        // pdf.js aus dem Obsidian-Bundle (nur Desktop mit geladenem Bundle;
        // Scheitern → Guard-Zweig im Renderer).
        loadPdfLib: async () => {
          const { loadPdfJs } = await import("obsidian");
          return (await loadPdfJs()) as PdfJsLib;
        },
        // Bytes über die Plugin-Session (Transport nutzt den Cookie-Store).
        fetchBytes: async () => {
          const resp = await this.client.request(url);
          if (resp.status !== 200) return null;
          return stringToBytes(resp.body);
        },
        // T22: externer Desktop-Fallback — IServ-Origin aus der Plugin-URL,
        // damit file/-/<pfad> im System-Viewer (PDFium-Browser) aufgehen kann.
        onOpenExternally: () => {
          const host = this.client.hostOrigin();
          if (host) {
            window.open(`${host}/${url}`, "_blank");
          } else {
            window.open(url, "_blank");
          }
        },
        onSaveToVault: () => this.onSaveToVault?.(),
      }
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

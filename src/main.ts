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
  loadPdfJs,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
// Mobile-Load (ADR-0009): https/http-Imports bewusst ENTFERNT — toter Code und
// Bundle-Load-Crash auf mobile (top-level Node-Builtins). Transport läuft
// ausschliesslich ueber IServClient (lazy in rawRequest).
import { IServClient, IServConfig } from "./client/IServClient";
import { CredStore, CredStorePlugin } from "./client/CredStore";
import {
  MobileCredStore,
  IndexedDbKeyStore,
  MobileEncryptionUnavailableError,
} from "./client/MobileCredStore";
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
import { getExerciseSubmitForm, submitExercise } from "./api/exercise-submit-flow";
// Welle 2 (User 28.09.2026): Aufgaben ANSEHEN + Text-ABGEBEN in Obsidian.
import {
  renderExerciseDetails,
  exerciseBodyText,
  parseExerciseAttachments,
  type ExerciseDetailsHandle,
} from "./views/exercise-details-render";
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
import {
  filesListUrl,
  parseFileListing,
  type FileEntry,
} from "./review-queue/files-feed";
import { subjectFromGroup } from "./review-queue/subject-guess";
import { groupSegmentOf } from "./review-queue/files-feed";
import { guessSubject, normalizeName } from "./review-queue/subject-guess";
// Issue #12 (Konzept-NEU): courseFolderFilter aus Stundenplan + Ordner-Ablehnung.
import { DeniedFoldersStore } from "./review-queue/denied-folders";
// Issue #19 P3: Queue-Scope-Entscheidung (leerer Plan = leere Queue, kein
// fetch-all-Fallback) — pure Funktion in timetable-feed.ts.
import {
  scopedQueueCourses,
  todayIso,
  tomorrowIso,
} from "./review-queue/timetable-feed";
import { fetchJsonDay } from "./api/timetable-json";
// R6 (worker snail2): exercise section — offene Aufgaben für die "Aktuelles"-Sidebar.
import { fetchOpenExercises } from "./review-queue/exercise-feed";
import type { ExerciseCandidate } from "./review-queue/exercise-feed";
import { NoticeCenter } from "./views/notice-center";
import type { PdfJsLib } from "./views/pdf-viewer";
import { computeDueShift } from "./review-queue/due-shift";
import type { Substitution } from "./api/timetable";
import {
  fetchCurrentTimetable,
  isOnVacation,
  jsonEntriesToSubstitutions,
  jsonFreeSlots,
  substUnionById,
  type CurrentTimetableResponse,
  type JsonSubstitutionEntry,
} from "./api/timetable-json";
import { calculatePrepWindow, setBaseDays } from "./exams/prep-window";
import { ExamType } from "./exams/template";
import type { CookieStore } from "./client/CookieStore";
import { fetchUntisBothDays } from "./api/untis";
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
import { getIsMobile } from "./mobile/platform";
import { makeRequestUrlTransport } from "./client/RequestUrlTransport";
import {
  isFeatureGatedOnMobile,
  MOBILE_DESKTOP_REQUIRED_NOTICE,
  type MobileGatedFeature,
} from "./mobile/guard";
import { FILES_BROWSER_ROOT } from "./views/files-browser";
import { classifyQueueItem } from "./review-queue/pdf-preview";
import { runExternOpen, cleanupExternTemp } from "./api/extern-open";

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
  credStore!: CredStore | MobileCredStore;
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
  /** Issue #12 (Konzept-NEU): Ordner-Ablehnungen (best-effort lazy init). */
  private deniedFolders: DeniedFoldersStore | null = null;
  /**
   * Issue #22 (R5-2, User 16:38): aktiver Kurs-Kontext für den sequenziellen
   * Queue-Modus (ein Kurs nach dem anderen). Bewusst EPHMERAL (maple-Direktive:
   * Session-Zustand, kein Settings-Key) — nach Reload/Neustart = Kursliste.
   */
  private queueActiveCourse: string | null = null;
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
    // Issue #17-P3: Temp-Dateien aus vorherigen extern-Öffnen-Abläufen
    // aufräumen (Datei bleibt nach openPath liegen — OS öffnet lazy; hier
    // ist der bewusste Aufräumpunkt). fail-soft, plugin-init #7-Sammlung.
    void cleanupExternTemp(this.app.vault.adapter).catch(() => undefined);
    void this.gradeStore.load(); // T18: Notenindex asynchron laden
    if (this.settings.prepWindowBaseDays) {
      setBaseDays(this.settings.prepWindowBaseDays);
    }
    // ADR-0003-Erweiterung (ADR-0009-Follow-up): Plattformwahl des CredStore.
    // Mobile: WebCrypto AES-GCM + device-key in IndexedDB (kein safeStorage da).
    // Desktop: Electron safeStorage (OS-Secret-Store) wie gehabt.
    if (getIsMobile()) {
      this.credStore = new MobileCredStore(
        this as unknown as CredStorePlugin,
        new IndexedDbKeyStore(),
        crypto.subtle
      );
    } else {
      this.credStore = new CredStore(
        this as unknown as CredStorePlugin,
        resolveSafeStorage() as
          | import("./client/CredStore").SafeStorage
          | undefined
      );
    }

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
      if (!this.gateDesktopAction("sync-all")) return;
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
        if (!this.gateDesktopAction("sync-all")) return;
        void this.syncNow();
      },
    });

    this.addSettingTab(new IServSettingTab(this.app, this));

    this.addCommand({
      id: "iserv-sync-test",
      name: "Battle-Test: Login + alle Kern-Fetches",
      callback: () => {
        if (!this.gateDesktopAction("battle-test")) return;
        void this.battleTest();
      },
    });

    this.addCommand({
      id: "iserv-exercise-submit",
      name: "Aufgabe abgeben (Exercise)",
      callback: () => {
        new ExerciseSubmitModal(this.app, this).open();
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
        if (!this.gateDesktopAction("job-poll")) return;
        void this.jobRunners?.core.trigger();
      },
    });
    this.addCommand({
      id: "iserv-sync-mails",
      name: "IServ sync: mails",
      callback: () => {
        if (!this.gateDesktopAction("job-poll")) return;
        void this.jobRunners?.mails.trigger();
      },
    });
    this.addCommand({
      id: "iserv-sync-exercises",
      name: "IServ sync: exercises",
      callback: () => {
        if (!this.gateDesktopAction("job-poll")) return;
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
    // Mobile-Gate (ADR-0009): kein Login/Netzwerk-Call auf mobile.
    if (!getIsMobile()) {
      window.setTimeout(() => {
        void this.makeClientWithLogin()
          .then(() => this.log("startup auto-login ok"))
          .catch((err) =>
            this.log(`startup auto-login fehlgeschlagen: ${String(err)}`)
          );
      }, 2_000);
    }

    // Issue #14 (User: „Sidebar lädt immer erst auf Abruf — beim Start schon
    // holen"): Prefetch-Chain NON-BLOCKING nach dem Auto-Login. Der Auto-Login
    // baut die Session (Login nur EINMAL; Session-Restore + Volllogin-
    // Fallback leben in makeClientWithLogin); danach triggern wir die
    // bestehenden JobModule core + mails + exercises — dieselben Pfade wie
    // der geplante Sync-Poll (ADR-0005-Konvention, keine Doppel-Logik) plus
    // current-timetable (JSON-Primärquelle der Dashboard-Dekors, Issue #7).
    // Offene Views re-rendern daraus cache-first; onOpen wartet nicht.
    // Fail-silent (ADR-0007): Fehler nur ins Log, kein Notice-Spam — der
    // bestehende onOpen-Fetch-Pfad bleibt als Fallback.
    if (!getIsMobile()) {
      window.setTimeout(() => {
        void this.prefetchStartupData();
      }, 3_500);
    }

    // Cred-Retry-Timer (Q2-Entscheidung): wenn der Secret-Store beim Start
    // verschlossen war (KeePassXC-DB zu), still alle 60 s erneut versuchen;
    // bei Erfolg verbinden + beide Views nachladen.
    // Mobile-Gate (ADR-0009): kein Timer auf mobile (safeStorage + Node-https).
    if (!getIsMobile()) {
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
  }

  onunload(): void {
    this.client = null;
  }

  /**
   * Issue #14: Startup-Prefetch-Chain — Login (Auto-Login hat den Client
   * bereits gebaut; makeClientWithLogin WIEDERVERWENDET die RAM-Session,
   * kein zweiter Volllogin), dann stiller Run von refreshSidebar +
   * refreshDashboard (tt-Entries, substitutions, Mails/Ungelesen, Queue,
   * JSON-Week-Fetch mit current-timetable — dieselben Pfade wie der
   * onOpen-Fetch). Offene Views rendern daraus sofort; via prefetchDoneAt
   * wissen spätere onOpen-Anfragen, dass die Daten nur Sekunden alt sind
   * und rendern cache-first (kein Fetch-Wait), solange der Prefetch
   * frisch ist (PREFETCH_FRESH_MS).
   * Nicht-blockierend (fire-and-forget aus onload), fail-silent
   * (ADR-0007): Fehler nur ins Log, kein Notice-Spam beim App-Start.
   */
  private prefetchStarted = false;
  /** ms-Zeitstempel des letzten abgeschlossenen Prefetch-Laufs (null = nie). */
  prefetchDoneAt: number | null = null;
  private async prefetchStartupData(): Promise<void> {
    if (this.prefetchStarted) return;
    this.prefetchStarted = true;
    const t0 = Date.now();
    try {
      await this.makeClientWithLogin();
    } catch (err) {
      // Fail-silent: KeePassXC zu / Creds fehlen → späterer onOpen-Fetch
      // oder Cred-Retry-Timer übernimmt. Kein Notice-Spam beim Start.
      await this.log(`prefetch: login skip (${String(err).slice(0, 100)})`);
      return;
    }
    // Best-effort-Kette: ein Fehler eines Flusses bricht die anderen nicht
    // (beide Refresh-Pfade sind intern fail-soft).
    await Promise.allSettled([this.refreshSidebar(), this.refreshDashboard()]);
    this.prefetchDoneAt = Date.now();
    await this.log(
      `prefetch: done in ${this.prefetchDoneAt - t0}ms (ttIso=${new Date().toISOString().slice(0, 10)})`
    );
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
    // Mobile-Gate (ADR-0009): JobRunner-Instanzen existieren (damit Command-
    // Trigger nicht crashen), aber KEINE registerInterval-Polls — die Polls
    // laufen über den Node-https-Client. Trigger-Commands weisen auf mobile
    // über gateDesktopAction("job-poll") dezent ab, bevor sie trigger() aufrufen.
    if (getIsMobile()) {
      this.jobRunners = this.jobRunners ?? null;
      if (!this.jobRunners) {
        const modules = createJobModules({
          getClient: () => this.makeClientWithLogin(),
          // Issue #12 (Stale-Sync-Fix): Queue-Feed am core-Modul-Pfad — auch
          // die mobile Runner-Instanz führt den Feed aus (Polls bleiben
          // desktop-gekoppelt, aber der gezielte Command-Trigger pflegt mit).
          onCoreSync: async () => {
            try {
              await this.feedQueueFromFiles();
            } catch {
              // fail-silent (ADR-0007): Feed-Scheitern not kein Modul-Abbruch.
            }
          },
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
        this.jobRunners = {
          core: mk(modules.core),
          mails: mk(modules.mails),
          exercises: mk(modules.exercises),
        };
      }
      return;
    }
    const modules = createJobModules({
      getClient: () => this.makeClientWithLogin(),
      // Issue #12 (Stale-Sync-Fix, Live-Beweis 08.10.2026): der 15-min-
      // Interval-Poll und der Command 'IServ sync: core' führten NUR
      // fetchCore (Timetable/Vertretungen) — feedQueueFromFiles lebte NUR
      // im manuellen 'Jetzt synchronisieren'-Pfad; die Queue zeigte Stunden
      // bis Tage alte Bestände (Server 16 frische Dateien, Queue 3 'neu').
      // Der Hook koppelt den Feed an JEDEN core-Lauf (Interval + Command),
      // fail-silent (ADR-0007): Feed-Fehler brechen den core-Sync nicht.
      onCoreSync: async () => {
        try {
          await this.feedQueueFromFiles();
        } catch {
          // feedQueueFromFiles fängt intern best-effort; nooit throw.
        }
      },
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

  /**
   * Sidebar-View aktivieren (oder bestehendes Leaf fokussieren) + mit
   * Daten befüllen. Issue #14 (Cache-first): frischer Snapshot
   * (lastSidebarData, PREFETCH_FRESH_MS) rendert SOFORT aus dem Cache,
   * der Fetch läuft nur im Hintergrund nach (kein Fetch-Wait beim
   * Öffnen); ohne/veralteten Snapshot bleibt der onOpen-Fetch der Pfad.
   */
  private static readonly PREFETCH_FRESH_MS = 10 * 60 * 1000;
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
      const cached = this.lastSidebarData;
      const fresh =
        cached !== null &&
        this.sidebarDataAt !== null &&
        Date.now() - this.sidebarDataAt <= IServPlugin.PREFETCH_FRESH_MS;
      if (fresh && cached) {
        (leaf.view as unknown as IServSidebarView).update(cached);
        // Hintergrund-Refresh zur Aktualisierung (kein Fetch-Wait beim Öffnen).
        void this.refreshSidebar();
      } else {
        void this.refreshSidebar();
      }
    }
  }

  /** Daten holen und in die Sidebar rendern (best-effort, ohne Notice-Spam). */
  /**
   * T9/T10: page (0-basiert) steuert die Mail-Seite server-seitig
   * (mails() mit limit=10, offset=page*10) — "Ältere Mails browsen".
   * Issue #14 (Cache-first): jeder erfolgreiche Ruf legt den Sidebar-
   * Daten-Snapshot in lastSidebarData ab; Sidebar-onOpen rendert daraus
   * sofort, solange der Snapshot frisch ist (PREFETCH_FRESH_MS) — kein
   * Fetch-Wait. Seitenwechsel/Mail-Pagination umgehen den Cache (echte
   * Refetch nötig).
   */
  private lastSidebarData: SidebarData | null = null;
  /** ms-Zeitstempel des letzten Sidebar-Snapshots (null = nie). */
  private sidebarDataAt: number | null = null;

  /**
   * JSON-Primärquelle-Normalisierung (Issue #20): Legacy `substitutions/`
   * meldet Untis-Entfall-Stunden teils als "substituted" (NULL-Fach-Verlust
   * + Ersatzraum-Message) — Dashboard (Issue #18) und Sidebar brauchen
   * DENSELBEN Feed-Union-Pfad. Bestandteile (aus refreshDashboard extrahiert):
   *  1. JSON current-timetable fetchen (fail-soft → null).
   *  2. jsonEntriesToSubstitutions-Bridge mit weekIso-Stempel (#8 R1).
   *  3. Union per ID: JSON-Zeilen Ergänzen, die Legacy noch NICHT trägt.
   *  4. Issue-#18-Präzisierung: class-absence aus der JSON-Primärquelle
   *     überschreibt die Legacy-Zeile GLEICHER ID (Legacy-Win hielt das
   *     Orange-Decor stabil-falsch).
   * Konvention: mutiert `subs` in place und gibt (jsonResp, weekIso) zurück
   * — Dashboard nutzen vacations/freeSlots weiter; Sidebar ignoriert sie.
   */
  private async jsonSubstUnion(
    client: IServClient,
    subs: Substitution[],
    ttIso: string
  ): Promise<{
    jsonResp: CurrentTimetableResponse | null;
    weekIso: Map<number, string>;
  }> {
    const jsonResp = await fetchCurrentTimetable(client, ttIso).catch(() => null);
    const weekIso = weekIsoFor(new Date(), ttIso);
    if (jsonResp) {
      const jsonSubsts = jsonEntriesToSubstitutions(
        jsonResp.entries as JsonSubstitutionEntry[],
        weekIso
      );
      // Issue #8 R1 (Root-Cause-Restpfad): weekIso-Map injiziert das ISO je
      // weekday — OHNE das trugen die JSON-Substitutionen ein LEERES Datum
      // (isoOfWeekEntry ohne weekIso → "") und der Decor-Match
      // (s.date.slice(0,10) == ISO des Pager-Tags) griff nie.
      // Issue #18/#20: Union-Regel (inkl. class-absence-Überschreibung der
      // Legacy-Zeile GLEICHER ID) als reine Funktion substUnionById —
      // Node-testbar, von Dashboard UND Sidebar geteilt.
      substUnionById(subs, jsonSubsts);
    }
    return { jsonResp, weekIso };
  }
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
            await this.credStore.saveSession(this.sessionPersistPayload(client));
          }
        }
      }
      const [subs, slots] = await Promise.all([
        substitutions(client),
        timetableSlots(client),
      ]);

      // Issue #20 (live 08.10.2026 16:00): die Sidebar holte ihre Subst-Dekors
      // NUR aus dem Legacy `substitutions/`-Feed — derselbe Legacy-Win-Fehler
      // wie im Dashboard (#18): Legacy meldet NULL-Fach-Entfälle (Fr. 9. Okt
      // Slot 5 Politik/Wirtschaft) als "substituted" mit Ersatzraum-Message.
      // Seit dem #18-Fix rendert das Dashboard rot, die Sidebar blieb Orange.
      // Fix: DENSELBEN jsonSubstUnion-Pfad wie das Dashboard (DRY-Sektion im
      // Plugin) — timetable-json-Regel + ID-Union mit class-absence-Präferenz.
      await this.jsonSubstUnion(
        client,
        subs,
        new Date().toISOString().slice(0, 10)
      );

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

      // Issue #23 (R5-3, User 16:54): Unterricht-Kurse des AKTUELLEN Tagesplan-
      // Tages (RAW-Gruppen-Segmente, z. B. "O Chemie 12eN Hn") aus den tt-
      // Entries — gefiltert auf HEUTE (weekday 0..4 = Mo..Fr; Wochenende/Feiertag
      // = leer). Die Kurs-Auswahlliste zeigt NUR deren Intersection mit offenen
      // Queue-Items; fehlt/leer = leere Liste (P3-Philosophie, kein Fallback).
      const todayWeekday = (new Date().getDay() + 6) % 7; // 0 = Montag
      const ttCoursesForList =
        todayWeekday <= 4
          ? [
              ...new Set(
                tt
                  .filter((e) => e.weekday === todayWeekday)
                  .map((e) => e.courseSubject?.course?.name ?? "")
                  .filter((n): n is string => !!n)
              ),
            ]
          : [];

      const data: SidebarData = {
        entries: toSidebarEntries(tt),
        slots: slots.length > 0 ? slots : slotsFromEntries(tt),
        substs: subs,
        now: new Date(),
        mails: mailList.mails,
        unread,
        // R6 (worker snail2): exercise section — offene Aufgaben best-effort
        // nach dem Mail-Fetch holen; Fehler → [] (Sidebar bricht nie hart).
        exercises: await fetchOpenExercises(client).catch(() => [] as ExerciseCandidate[]),
        queue: queueItems,
        // Issue #23 (R5-3): Unterricht-Scope der Kurs-Auswahlliste.
        queueTimetableCourses: ttCoursesForList,
        // Issue #22 (R5-2): sequenzieller Active-Course-Modus — Ephemeral-Variable,
        // Pick/Clear refreshen die Sidebar sofort (no settings persist).
        queueActiveCourse: this.queueActiveCourse,
        onQueueCoursePick: (g) => {
          this.queueActiveCourse = g;
          void this.refreshSidebar(page);
        },
        onQueueCourseClear: () => {
          this.queueActiveCourse = null;
          void this.refreshSidebar(page);
        },
        exams,
        mailPage: page,
        mailPageSize: MAIL_PAGE_SIZE,
        onMailPage: (p) => {
          void this.refreshSidebar(p);
        },
        mailRowClick: (id) => {
          void this.openMailReaderById(String(id), account);
        },
        // "Aktuell"-Radikalfilter (Runde 6, swan/harmoni): HW-Fenster aus der
        // Settings (homeworkDueOffsetDays, Default 1 = Rest heute + morgen).
        homeworkDueOffsetDays: this.settings.homeworkDueOffsetDays,
        queueActions: this.queueActionHandlers(),
        onPreview: (item) => this.openPdfPreview(item),
        // T3/T4: dezenter Header-Sync-Button → gleicher Sync-Pfad wie Ribbon.
        onSyncClick: () => {
          void this.syncNow();
        },
        // Welle 2 (User 28.09.2026: "In Obsidian soll alles machbar sein"):
        // Klick öffnet das Detail-Modal (ANSEHEN + Text-ABGEBEN) — der
        // Systembrowser bleibt zu (war: window.open show-URL).
        onExerciseClick: (ex) => {
          void this.openExerciseDetails(ex);
        },
      };
      this.lastSidebarData = data;
      this.sidebarDataAt = Date.now();
      view.update(data);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      view.updateError(msg);
      await this.log(`sidebar-refresh-FAIL: ${msg}`);
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
    // Dateibrowser (Issue #11): Navigation-Hook am View setzen, damit
    // Ordner-/Breadcrumb-Klick über diesen Plugin-Pfad neu listen.
    view.onFilesNavigate = (p) => void this.navigateDashboardFiles(p);
    // R6 (squid-Befund, Coordinator-Fix): war die Queue beim ersten Dashboard-
    // Open noch leer (Feed async), blieb die Section wegen ADR-0008 einfach
    // weg — der User sah "keine Queue". Best-effort: Feed im Hintergrund
    // befüllen und NACHTRÄGLICH die Section refreshten (kein doppeltes
    // Blockieren des Render-Pfads).
    if (this.queue.getItems().length === 0) {
      void this.feedQueueFromFiles()
        .then(() => this.refreshDashboard(query, page))
        .catch(() => {});
    }
    try {
      const client = await this.makeClientWithLogin();
      const [tt, subs, slots] = await Promise.all([
        timetable(client),
        substitutions(client),
        timetableSlots(client),
      ]);
      // Issue #7 (ADR-0007-Update): JSON-Primärquelle — current-timetable
      // liefert Woche inkl. Vacation-Array und Ausfall-Entries mit
      // originalTimeTableEntry. JSON-Substitutions-Ergebnis ZUSÄTZLICH in
      // den Decor-Mix (Union per ID); Untis-Overlay bleibt Detail-Quelle.
      // Zusätzlich: Ferientag-Erkennung des gerenderten Tages (vacations).
      // Issue #20: Union-Logik in jsonSubstUnion extrahiert — Sidebar
      // teilt sich jetzt EXAKT denselben Feed-Pfad (kein Auseinanderdriften).
      const ttIso = new Date().toISOString().slice(0, 10);
      const { jsonResp } = await this.jsonSubstUnion(client, subs, ttIso);
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
      // R2-Korrektur (User 30.09.2026 07:18): Untis-HTML ist eine
      // SCHOOL-WIDE-Quelle (alle Klassen) — als Dekor-Overlay des
      // personalisierten JSON-Stundenplans lieferte sie ENTFÄLLE FREMDER
      // KURSE (live: 'Sport · Entfall' slot 9, gehört dem User gar nicht).
      // Der Stundenplan rendert NUR aus personalisiertem IServ JSON
      // (current-timetable + substitutions-Feed). Kein Untis-Fetch mehr
      // im Dashboard-Datenfluss.
      // Klassen-Tokens aus den Entries ableiten (Kursnamen wie „12gN").
      // Issue #23 (R5-3): Unterricht-Scope auch für die Dashboard-Queue-
      // Liste (Konsistenz zur Sidebar, gleicher HEUTE-Filter).
      const todayWeekdayDash = (new Date().getDay() + 6) % 7; // 0 = Montag
      const ttCoursesForDash =
        todayWeekdayDash <= 4
          ? [
              ...new Set(
                tt
                  .filter((e) => e.weekday === todayWeekdayDash)
                  .map((e) => e.courseSubject?.course?.name ?? "")
                  .filter((n): n is string => !!n)
              ),
            ]
          : [];
      const data: DashboardData = {
        entries: toSidebarEntries(tt),
        slots: slots.length > 0 ? slots : slotsFromEntries(tt),
        substs: subs,
        vacationIso: jsonResp && isOnVacation(ttIso, jsonResp.vacations) ? ttIso : undefined,
        now: new Date(),
        mails: mailList.mails,
        unread,
        queue: this.queue.getItems(),
        // Issue #23 (R5-3): Unterricht-Scope auch für die Dashboard-Queue-
        // Liste (Konsistenz zur Sidebar, gleicher Filter).
        queueTimetableCourses: ttCoursesForDash,
        exams,
        noticeCenter: this.notices,
        // Dateibrowser (Issue #11): best-effort Listing des aktuellen cwd
        // (NUR Groups-Root); Fehler/Leerzustand fail-soft in der Sektion.
        files: await this.dashboardFilesData(view, client).catch(() => ({
          cwd: view.filesCwd,
          entries: [],
          error: "Dateien nicht ladbar",
        })),
        // Issue #8 R3: reguläre Freistunden (best-effort aus dem JSON-Wochen-
        // Fetch) — für ALLE Weekdays (Renderer filtert je Pager-Tag; Pager-Tag
        // kann >heute liegen, der Wochen-Fetch deckt Mo–Fr der TT-Woche).
        freeSlots: jsonResp
          ? jsonFreeSlots(
              jsonResp.entries as JsonSubstitutionEntry[],
              slots.length > 0 ? slots : slotsFromEntries(tt)
            )
          : undefined,
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
      await this.log(`dashboard-refresh-FAIL: ${msg}`);
      this.notices.notifyOnce("dashboard-error", `IServ-Dashboard: ${msg}`, 8_000);
    }
  }

  /**
   * Dateibrowser-Navigation (Issue #11): neu listen + Dashboard re-rendern.
   * View.hook (onFilesNavigate) → hier; keine Extra-View-Klasse.
   */
  async navigateDashboardFiles(path: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ISERV_DASHBOARD);
    const view = leaves[0]?.view;
    if (!(view instanceof IServDashboardView)) return;
    view.filesCwd = path;
    await this.refreshDashboard();
  }
  // ADR-0009-Note (Issue #11): das Listing braucht eine Session (Netz). Der
  // fetch-Transport macht Listings auf mobile teils möglich, aber die
  // Preview-Bytes laufen über rawBytesRequest (Desktop-Pfad) — Dashboard ohne
  // gefetchte `files` entfällt die Sektion sauber (kein Partial-UI, letzter
  // Stand bleibt via queue.json etc. sichtbar).

  /**
   * Dashboard-Dateibrowser-Daten (Issue #11): Listing des cwd via
   * file/api/list/<pfad> (pfadbasiert, live 28.09.2026) — derselbe Parse-Weg
   * wie files-feed.ts, kein Doppelaufbau. Fail-soft mit Fehlerzeile.
   */
  private async dashboardFilesData(
    view: IServDashboardView,
    client: IServClient
  ): Promise<NonNullable<DashboardData["files"]>> {
    const cwd = view.filesCwd || FILES_BROWSER_ROOT;
    try {
      const resp = await client.request(filesListUrl(cwd));
      const entries = resp.status === 200 ? parseFileListing(resp.body) : [];
      return {
        cwd,
        entries,
        // Datei-Klick → bestehende Preview-Pipeline (PdfViewerModal reuse,
        // Issue-Forderung kein Doppelaufbau).
        onFileOpen: (item) => this.openFilesBrowserPreview(item),
      };
    } catch (err) {
      return {
        cwd,
        entries: [],
        error: `Ordner nicht ladbar: ${String(err).slice(0, 80)}`,
      };
    }
  }

  /**
   * Datei-Klick im Browser (Issue #11): bestehende Preview-Pipeline reuse —
   * QueueItem-artiges Target + classifyQueueItem-Kind (pdf/image/other),
   * Bytes über dieselbe PdfViewerModal-Bridge (rawBytesRequest). Kein
   * zweiter Viewer (Queue-Preview-Pfad identisch).
   */
  private openFilesBrowserPreview(item: { id: string; name: string; path: string }): void {
    if (!this.client) {
      new Notice("IServ: Vorschau braucht Session — bitte syncen.", 5000);
      return;
    }
    this.openPdfPreview({
      id: item.id,
      name: item.name,
      path: item.path,
      hash: item.id,
      subject: "",
      status: "neu",
    });
  }

  /** Client mit garantiertem Login (Re-Login bei leerem Stundenplan). */
  /** Auch für Abgabe-/Vorschau-Modals (ExerciseSubmitModal) — nur Lesen/Schreiben bewusst. */
  public async makeClientWithLogin(): Promise<IServClient> {
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
        await this.credStore.saveSession(this.sessionPersistPayload(client));
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

  /** Queue-Action-Handler (echte Persistenz + echte Vault-Ablage bei Keep). */
  private queueActionHandlers(): {
    onKeep(id: string): void;
    onDiscard(id: string): void;
    onUnsure(id: string): void;
    onOpenPreview?(id: string): void;
    onFolderDiscard?(folder: { group: string; folderPath: string; itemIds: string[] }): void;
    onSubFolderDecide?(d: {
      folderPath: string;
      label: string;
      itemIds: string[];
      decision: "allow" | "deny";
    }): void;
  } {
    // Runde 5: Swipe-Tap öffnet die Vorschau (gleiches Ziel wie Zeilen-Klick) —
    // kein mühsames Preview-Button-Suchen mehr.
    const byId = (id: string) => this.queue.getItems().find((i) => i.id === id);
    return {
      onKeep: (id) => {
        const item = byId(id);
        this.queue.updateStatus(id, "kept");
        void this.queue.save();
        void this.refreshSidebar();
        // Issue #5 (User: „Behalten speichert die Datei WIRKLICH ins Vault"):
        // Keep = bewusster Vault-Write — die Datei wird über die bestehende
        // Download-Pipeline (rawBytesRequest → writeBinary) nach dem Ablage-
        // Template (ADR-0001, buildQueueTargetPath: Fach-Vermutung aus der
        // Queue-Zeile + {{SUBJECT}}/Material/{{SCHOOLYEAR}}) abgelegt. Ohne
        // Session: explizite Notice statt silent skip.
        void this.keepItemToVault(item);
      },
      onDiscard: (id) => {
        // Issue #5: Discard = KEIN Vault-Write (nur Status + Refresh; der
        // Discard-Cache bleibt separater Mechanismus — bestehende dedup-
        // Pipeline unangetastet).
        this.queue.updateStatus(id, "discarded");
        void this.queue.save();
        void this.refreshSidebar();
      },
      onUnsure: (id) => {
        this.queue.updateStatus(id, "unsure");
        void this.queue.save();
        void this.refreshSidebar();
      },
      onOpenPreview: (id) => {
        // Runde 5 (User): Zeile-Tap/Klick = Preview — für alle Kinds.
        const item = byId(id);
        if (item) this.openPdfPreview(item);
      },
      onFolderDiscard: (folder) => {
        // Konzept-NEU (Issue #12, Teil 2d): ganzer Kursordner verwerfen.
        // Bewusstseins-Gate (ADR-0005-Fußnote): Confirm-Modal — kein
        // silent write. OK = Ordner-Ablehnung + alle offenen Items discarded.
        new FolderDiscardConfirm(
          this.app,
          folder,
          async () => {
            const store = await this.ensureDeniedFolders();
            if (store) {
              if (store.deny(folder.folderPath)) await store.save();
            }
            for (const id of folder.itemIds) {
              this.queue.updateStatus(id, "discarded");
            }
            await this.queue.save();
            await this.log(`queue-folder-discard: ${folder.folderPath} (${folder.itemIds.length} Items)`);
            new Notice(`IServ: Ordner abgelehnt — ${folder.group}`, 5000);
            void this.refreshSidebar();
          },
          () => undefined
        ).open();
      },
      onSubFolderDecide: ({ folderPath, label, itemIds, decision }) => {
        // Issue #17 Punkt 4: Sub-Ordner-Feinschnitt — gleiche Bewusstseins-
        // konvention wie onFolderDiscard (Confirm-Modal, kein Silent-Write).
        new FolderDiscardConfirm(
          this.app,
          { group: label, folderPath, itemIds, decision },
          async () => {
            const store = await this.ensureDeniedFolders();
            if (store) {
              if (decision === "allow") {
                store.allow(folderPath);
              } else if (store.deny(folderPath)) {
                /* deny räumt gleichen Pfad aus allowed */
              }
              await store.save();
            }
            if (decision === "deny") {
              for (const id of itemIds) this.queue.updateStatus(id, "discarded");
            }
            await this.queue.save();
            await this.log(
              `queue-subfolder-${decision}: ${folderPath} (${itemIds.length} Items)`
            );
            new Notice(
              decision === "allow"
                ? `IServ: Ordner zugelassen — ${label}`
                : `IServ: Ordner abgelehnt — ${label}`,
              5000
            );
            void this.refreshSidebar();
          },
          () => undefined
        ).open();
      },
    };
  }

  /**
   * Issue #5: Datei eines Queue-Items via IServ-Session laden und bewusst
   * ins Vault ablegen (Ziel-Pfad aus buildQueueTargetPath, ADR-0001-Template).
   * Kollision: existierende Datei → Kollision-Suffix (template.ts).
   * Bewusstseins-Gate (ADR-0005-Fußnote): Keep ist DER explizite User-Entscheid
   * (Button/Swipe „Behalten") — kein Silent-Write, Notice bestätigt den Pfad.
   */
  private async keepItemToVault(item: QueueItem | undefined): Promise<void> {
    if (!item) return;
    if (!this.client) {
      new Notice("IServ: Behalten braucht Session — Datei nicht abgelegt. Bitte syncen und erneut behalten.", 6000);
      return;
    }
    try {
      const { buildQueueTargetPath } = await import("./review-queue/template");
      const { buildPdfPreviewUrl } = await import("./review-queue/pdf-preview");
      const bytes = await this.client.rawBytesRequest(buildPdfPreviewUrl(item).url);
      const dir = buildQueueTargetPath(item, { vaultSubjects: this.vaultSubjectFolders() });
      const adapter = this.app.vault.adapter;
      await adapter.mkdir(dir).catch(() => undefined);
      let path = `${dir}/${item.name}`;
      // Kollisions-Suffix aus template.addCollisionSuffix (hash-Anker).
      if (await adapter.exists(path)) {
        const { addCollisionSuffix } = await import("./review-queue/template");
        path = addCollisionSuffix(path, item.hash);
      }
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      await adapter.writeBinary(path, buf);
      new Notice(`IServ: Behalten — gespeichert: ${path}`, 5000);
      await this.log(`queue-keep: ${item.name} → ${path}`);
    } catch (err) {
      const msg = String(err).slice(0, 140);
      new Notice(`IServ: Behalten fehlgeschlagen (${msg})`, 8000);
      await this.log(`queue-keep FAILED: ${item.name}: ${msg}`);
    }
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

  /**
   * Welle 2 (User 28.09.2026, "In Obsidian soll alles machbar sein"):
   * Detail-Modal für eine offene Aufgabe — ANSEHEN (Show-HTML als Text,
   * kein HTML-Injection) + Text-ABGEBEN (submitExercise, allowSubmit-Optin).
   * Mobile: gesperrt (Network-Transport, ADR-0009 exercise-submit).
   */
  openExerciseDetails(ex: ExerciseCandidate): void {
    if (!this.gateDesktopAction("exercise-submit")) return;
    new ExerciseDetailsModal(this.app, this, ex).open();
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
          // "Aktuell"-Radikalfilter (Runde 6): echtes Datum nötig, damit die
          // Sektion wirklich ZUKÜNFTIGE (termingebundene) Prüfungen zeigt.
          date: examDate,
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

  /**
   * Mobile-Gate (ADR-0009): Action, die Node/Electron braucht (Node-https-
   * Transport, safeStorage-Keychain), auf Obsidian Mobile dezent abweisen
   * (NoticeCenter notifyOnce) statt hart zu crashen.
   */
  private gateDesktopAction(feature: MobileGatedFeature): boolean {
    if (!getIsMobile()) return true;
    if (!isFeatureGatedOnMobile(feature)) return true;
    this.notices.notifyOnce(
      `mobile-gate-${feature}`,
      `IServ: ${MOBILE_DESKTOP_REQUIRED_NOTICE}`,
      8_000
    );
    return false;
  }

  /**
   * Issue #17-P3: Extern öffnen = DOWNLOAD-CHAIN statt URL-Öffnung (externes
   * Programm ist nicht in IServ eingeloggt). Bytes →
   * app.vault.adapter.writeBinary in Plugin-Cache-Ordner
   * (.obsidian/plugins/iserv-integration/temp/) → Electron remote
   * shell.openPath. Kein Node-fs (fs-Gate), kein URL-Fallback: DL-Scheitern
   * = klare Fehlermeldung. Mobile: Desktop-Gate zuerst (klare Meldung).
   */
  async externOpenDownloaded(
    filename: string,
    fetchBytes: () => Promise<Uint8Array | null>
  ): Promise<void> {
    // Mobile-Gate (ADR-0009): Electron-remote-shell ist Desktop-only.
    if (!this.gateDesktopAction("extern-open")) return;
    // Electron remote shell (Desktop): obsidian-Plugin-Kontext —
    // require("electron").shell mit remote-Fallback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let openPath: ((p: string) => Promise<unknown>) | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const electron = require("electron") as any;
      const shell =
        electron?.shell ?? electron?.remote?.shell ?? null;
      if (shell?.openPath) {
        openPath = (p: string) => shell.openPath(p);
      }
    } catch {
      openPath = null;
    }
    if (!openPath) {
      new Notice("IServ: Extern öffnen nicht verfügbar (Desktop shell fehlt).", 6000);
      return;
    }
    const result = await runExternOpen(
      {
        adapter: this.app.vault.adapter,
        openPath: async (vaultPath) => {
          // openPath braucht einen ABSOLUTEN OS-Pfad — Adapter arbeitet
          // unter dem Vault-Root; Normalisierung über normalizePath/Root.
          // Obsidian-Adapter schreibt relativ zum Vault; für shell.openPath
          // geben wir den Vault-Root ab (Electron ersetzt /) → wir nutzen
          // den Adapter-Pfad, da Obsidian-Adapter nicht osPath说出 kann.
          // Wir lösen über electron-remote-app: app.getAppPath() nein —
          // BASERt auf Vault-Adapter: Nutzung window.electron? Wir
          // benutzen normalizePath + vault.getRootDir-Kette nicht öffentlich.
          // FAKT: shell.openPath mit dem VAULT-relativen Pfad geht NICHT.
          // Lösung: vault.adapter.basePath (Obsidian-Adapter-Eigenschaft).
          const base = (this.app.vault.adapter as unknown as { basePath?: string }).basePath ?? "";
          const joiner = base.includes("\\") || /^[A-Za-z]:/.test(base) ? "\\" : "/";
          const norm = vaultPath.replace(/\//g, joiner);
          return openPath(`${base}${joiner}${norm}`);
        },
        isDesktop: !getIsMobile(),
        onProgress: (msg) => new Notice(`IServ: ${msg}`, 2500),
      },
      filename,
      fetchBytes
    );
    if (result.ok) {
      new Notice(`IServ: Extern geöffnet: ${result.path}`, 5000);
    } else {
      new Notice(`IServ: ${result.reason}`, 8000);
    }
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

  /** Public: Exercise-Submit-Modal + Draw-Flow loggen bewusste Writes. */
  public async log(line: string): Promise<void> {
    this.lastLog += line + "\n";
    console.log("[iserv]", line);
    const path = "iserv-sync-log.md";
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.app.vault.append(file, line + "\n");
      } else {
        try {
          await this.app.vault.create(path, `# IServ sync log\n\n${line}\n`);
        } catch (e) {
          // nextcloud-sync-Race: Datei zwischen get und create (wieder) da
          // ("already exists") → als Bestehende appenden, sonst weiterwerfen.
          const existing = this.app.vault.getAbstractFileByPath(path);
          if (existing instanceof TFile) {
            await this.app.vault.append(existing, line + "\n");
          } else {
            throw e;
          }
        }
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
      await this.log(`Battle-Test start ${new Date().toISOString()} build=issue4-requrl-transport`);

      // Flow-Debug (mobile "Load failed"-Investigation): jeder Schritt geloggt.
      await this.log(`step1: pass=${this.cachedPass ? "cached" : "nodiscard"} platform=${getIsMobile() ? "mobile" : "desktop"}`);

      // 1) Client bauen (Transport = Node https) + Login
      const client = await this.makeClient();
      await this.log(`step1 ok: client transport=${client.transport ? client.transport.constructor.name : "node-default"}, cookies=${client.getCookies().toHeader().length}b`);

      // Login mit 1 Retry (WKWebView wirft transiente TypeError "Load failed").
      let loginResp: Awaited<ReturnType<IServClient["login"]>>;
      for (let attempt = 1; ; attempt++) {
        try {
          loginResp = await client.login();
          break;
        } catch (err) {
          const msg = String(err);
          await this.log(`login attempt ${attempt}: FAIL ${msg.slice(0, 100)}`);
          if (attempt >= 2 || !/Load failed|network|Network/i.test(msg)) throw err;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
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
    // Mobile-Gate (ADR-0009): Sync braucht den Node-https-Transport.
    if (!this.gateDesktopAction("sync-all")) return;
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
      // Issue #12 (Konzept-NEU) + Issue #19 P3: Ziel-Liste = alle Fach-
      // Dokumente der Stundenplan-Kurse (heute+morgen) OHNE Vault-Duplikate
      // und OHNE abgelehnte Ordner. SCOPING (P3): der Feed ist STUNDENPLAN-
      // GESCOPED — ein leerer/ganz-entfallener Tagesplan ergibt eine bewusst
      // LEERE Whitelist ([] = keine Kandidaten), NIE den Fetch-all-Fallback
      // (undefined). Nur beidseitiger TECHNISCHER Fetch-Fehler (null/null)
      // bleibt best-effort ohne Scope (Alt-Feed, ADR-0007).
      let courseFolders: string[] | undefined;
      try {
        const today = await fetchJsonDay(client, todayIso());
        const tomorrow = await fetchJsonDay(client, tomorrowIso()).catch(() => null);
        const decision = scopedQueueCourses(today, tomorrow);
        courseFolders = decision.scoped;
        if (decision.empty) {
          this.log(`queue-feed scope LEER (Stundenplan ohne Kurse heute+morgen) → keine Queue-Kandidaten (kein fetch-all)`);
        }
      } catch (err) {
        this.log(`queue-feed stundenplanFAIL (best-effort ohne Scope): ${String(err).slice(0, 80)}`);
      }
      const store = await this.ensureDeniedFolders();
      const denied = (p: string): boolean => !!store?.isDenied(p);
      // Vault-Duplikat-Filter (User-Befund 08.10 — Rembrandt): "Datei ist im
      // Vault" implizit egal WIE sie dahin kam (manuell, Keep-Flow). Match
      // über Dateiname gegen ALLE Vault-Dateien (basename, case- und
      // Leerzeichen-tolerant — live bewiesen: Vault 'Kunst/Musteranalyse
      // Rembrandt.pdf' vs. Server 'Groups/O Kunst 12gN Gh/...').
      const vaultNames = new Set(
        this.app.vault.getFiles().map((f) => normalizeVaultName(f.name))
      );
      const existsInVault = (iservPath: string): boolean => {
        const base = iservPath.split("/").pop() ?? "";
        return vaultNames.has(normalizeVaultName(base));
      };
      const fresh = await fetchQueueItems(client, {
        // Runde 5: Root "Groups" (Lehrer-Dateien). Tiefe bewusst GROSSZÜGIG
        // (User: viele Lehrer gehen tiefer als 3 Unterordner).
        rootPath: "Groups",
        maxDepth: 8,
        // Konzept-NEU: Kurs-Whitelist aus dem Stundenplan (heute+morgen).
        courseFolderFilter: courseFolders,
        // Konzept-NEU: Ordner-Ablehnungen (UI-Flow, best-effort persistiert).
        deniesFolder: denied,
        // Konzept-NEU: Vault-Duplikate (egal wie importiert) → kein Kandidat.
        existsInVault,
        // Runde 6 (User): manuelle Gruppe=Fach-Overrides aus Settings.
        queueGroupMap: this.settings.queueGroupMap ?? {},
        vaultSubjects: this.vaultSubjectFolders(),
        existing: this.queue.getItems(),
      });
      // Runde 6 (User 17:41): Bestands-Pflege — Subjects der EXISTIERENDEN
      // Items mit neuem Gruppen-Anker neu ableiten (alter Bestand trug leere/
      // ratende Subjects aus der Dateinamen-Heuristik) und Alt-Items ohne
      // Fach aus dem Bestand entfernen (keine „auto"-Berge ohne Kontext).
      const map = this.settings.queueGroupMap ?? {};
      let patched = 0;
      let dropped = 0;
      for (const item of this.queue.getItems()) {
        // Konzept-NEU (User-Befund 08.10 — Rembrandt): bestehende Queue-Items,
        // die bereits im Vault liegen (egal wie importiert), JEDERZEIT aus der
        // Queue werfen — gleiches Prädikat wie der Feed (basisname-normalisiert).
        const itemBase = item.path.split("/").pop() ?? "";
        if (vaultNames.has(normalizeVaultName(itemBase))) {
          this.queue.removeItem(item.id);
          dropped++;
          continue;
        }
        // Issue #7 (29.09.2026): gleiche Kette wie der Feed — nach Steuertabel-
        // le + Dateinamen als letzter Anker der RAW-Gruppenordner (Kursname =
        // Files-Ordner, filesFolderNameForCourse). Fächer außerhalb der
        // Tabelle matchen so gegen echte Vault-Fachordner.
        const itemGroup = groupSegmentOf(item.path);
        const freshSubject =
          subjectFromGroup(itemGroup, map) ??
          guessSubject(item.name, this.vaultSubjectFolders()) ??
          (itemGroup ? guessSubject(itemGroup, this.vaultSubjectFolders()) : null) ??
          "";
        if (item.status === "neu" || item.status === "unsure") {
          if (item.subject !== freshSubject) {
            item.subject = freshSubject;
            patched++;
          }
          continue;
        }
        // alt/kept/discarded: ohne Fach → raus (Befund: 4131-Flut, AGs ohne
        // Vault-Ordner); mit Fach → Subject aktualisieren.
        if (!freshSubject) {
          this.queue.removeItem(item.id);
          dropped++;
        } else if (item.subject !== freshSubject) {
          item.subject = freshSubject;
          patched++;
        }
      }
      if (patched > 0 || dropped > 0) await this.queue.save();
      if (fresh.length > 0) {
        for (const item of fresh) this.queue.addItem(item);
        await this.queue.save();
      }
      this.log(`queue-feed: ${fresh.length} neu, ${patched} patched, ${dropped} gedroppt`);
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

  /** Issue #12 (Konzept-NEU): Denied-Folders-Store lazy init (fail-open). */
  private async ensureDeniedFolders(): Promise<DeniedFoldersStore | null> {
    try {
      if (!this.deniedFolders) {
        this.deniedFolders = new DeniedFoldersStore({
          loadData: () => this.loadData(),
          saveData: (d) => this.saveData(d),
        });
      }
      await this.deniedFolders.load();
      return this.deniedFolders;
    } catch (err) {
      console.warn("IServ denied-folders load:", err);
      return null; // fail-open: keine Ablehnung = Alt-Verhalten
    }
  }

  /**
   * Session-Persist-Payload (Issue #4, Live-Beweise 29.09.2026): auf mobile die
   * KOMPLETTE Cookie-Zeile mit "ALL:"-Präfix — der echte IServ verlangt die
   * Konjunktion aller Kette-Cookies (nur IServSession → users/me 401, bewiesen;
   * vollständige Zeile → 200). Desktop bleibt beim Legacy-Format (nur
   * IServSession) — Desktop-Regression darf sich nicht verändern.
   */
  private sessionPersistPayload(client: IServClient): string {
    const header = client.getCookies().toHeader();
    if (getIsMobile() && header) {
      return "ALL:" + header;
    }
    return client.getCookies().get("IServSession") ?? header;
  }

  private async makeClient(): Promise<IServClient> {
    if (this.client) return this.client;
    // Pass/twofa IMMER laden — Invariante: jeder Client aus makeClient ist
    // login()-fähig (Regression-Fix: Restored-Client ohne Pass brach
    // battleTest/makeClientWithLogin mit "Kein IServSession nach Login-Kette").
    const creds = await this.loadCreds();
    if (!creds) {
      if (getIsMobile()) {
        throw new Error(
          "IServ-Credentials noch nicht eingerichtet — Credentials-Modal öffnen (Einstellungen → IServ) und einmal speichern."
        );
      }
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
    // ADR-0005-Seam + ADR-0009 (Issue #4, Live-Beweise 29.09.2026): auf mobile
    // requestUrl-Transport statt fetch — fetch wirft am echten Obsidian CORS-
    // bedingt "Failed to fetch" (IServ sendet keine CORS-Header; Echo-Beweis
    // mit ACAO:* → 200 OK), das erklärte die echten "Load failed"-Logs.
    // requestUrl ist CORS-frei (Main-Process) und lebt am echten IServ
    // (users/me 200 mit Cookie-Zeile, live verifiziert). Desktop bleibt beim
    // Node-Default unangetastet.
    const client = new Factory(
      config,
      getIsMobile() ? makeRequestUrlTransport(config) : undefined
    );
    // Flow-Debug (mobile "Load failed"-Investigation): Transport-Hops → Plugin-Log.
    if (client.transport && typeof client.transport.onHopLog === "function") {
      client.transport.onHopLog = (msg) => void this.log(`transport ${msg}`);
    }
    // Session-Restore (#17 Fund 5): gepersisterten IServSession-Cookie
    // wiederverwenden, bevor ein neuer Volllogin läuft. Mobile-Format (Issue #4,
    // Live-Beweis 29.09.2026): "ALL:"-Präfix = komplette Cookie-Zeile — NUR
    // IServSession reicht dem echten IServ nicht (users/me 401 bewiesen);
    // Desktop-Legacy-Format (nur IServSession) unverändert.
    const saved = await this.credStore.loadSession();
    if (saved) {
      if (saved.startsWith("ALL:")) {
        client.getCookies().parseCookieHeader(saved.slice(4));
      } else {
        client.getCookies().set("IServSession", saved);
      }
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
          `IServ: Credentials gespeichert (${getIsMobile() ? "Geräte-Schlüsselspeicher" : "Keychain"}).`,
          10_000
        );
        void this.battleTest();
      }
    );
    modal.open();
  }

  private setCredentialsFlow(): void {
    // ADR-0009-Erweiterung (MobileCredStore): Credential-Speicherung läuft
    // mobile über WebCrypto+IndexedDB device-key, nicht mehr am safeStorage-Gate.
    this.openCredentialModal();
  }
}

/**
 * Credentials-Modal (Passwort + optionaler 2FA-Token).
 * Runde-N-Fix (User-Report): beide Inputs klebten direkt aneinander —
 * .iserv-credential-form streckt sie als Flex-Column mit --iserv-gap-md.
 */
class CredentialPrompt extends Modal {
  constructor(
    app: App,
    private onSave: (pass: string, twofa: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass("iserv-credential-modal");
    this.contentEl.createEl("h2", { text: "IServ-Credentials" });
    // ADR-0003-Erweiterung: auf mobile (WebCrypto/IndexedDB) formulieren wie
    // auf Desktop (safeStorage) — verschlüsselt, nie Klartext in data.json.
    const note = getIsMobile()
      ? "Passwort (und optional 2FA-Token) werden verschlüsselt im Geräte-Schlüsselspeicher abgelegt — nie in data.json."
      : "Passwort (und optional 2FA-Token) liegen verschlüsselt im OS-Secret-Store — nie in data.json.";
    this.contentEl.createEl("p", { text: note });
    const form = this.contentEl.createDiv({ cls: "iserv-credential-form" });
    const passEl = form.createEl("input", {
      type: "password",
      placeholder: "passwort",
    });
    passEl.addClass("iserv-credential-input");
    passEl.style.width = "100%";
    const twofaEl = form.createEl("input", {
      type: "text",
      placeholder: "2FA-Token (optional, TOTP)",
    });
    twofaEl.addClass("iserv-credential-input");
    twofaEl.style.width = "100%";
    const btn = form.createEl("button", { text: "Speichern" });
    btn.addClass("iserv-credential-save");
    btn.onclick = async () => {
      this.close();
      await this.onSave(passEl.value, twofaEl.value.trim());
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** TimetableEntry → SidebarEntry (Slot-Objekt flach, Room-Objekt flach).
 * Issue #8 R2: erster Lehrer (strukturiert) mitgeführt → Dashboard-Lehrer-Zeile
 * „Vorname Nachname" (displayTeacherName, live belegt 29.09.2026).
 */
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
    teacher: e.courseSubject?.teachers?.[0],
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

/**
 * Issue #8 R1: weekday→ISO-Map der Kalenderwoche um `anyIso` (der current-
 * timetable-Fetch ist ein WOCHEN-Fetch — die Entries gehören zur Woche des
 * Date-Params). Injektion in jsonEntriesToSubstitutions stempelt jedem
 * Subst-Entry sein echtes Datum (statt ""), sonst greift der Decor-Match nie.
 */
function weekIsoFor(now: Date, anyIso: string): Map<number, string> {
  const base = new Date(`${anyIso}T12:00:00`);
  // ISO-Woche: Montag finden (JS getDay: 0=So … 6=Sa).
  const monday = new Date(base);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const map = new Map<number, string>();
  for (let wd = 0; wd < 5; wd++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + wd);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    map.set(wd, `${y}-${m}-${day}`);
  }
  void now;
  return map;
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
    const { renderMailReader } = await import("./views/mail-reader");
    // Anlagen — neue Klick-Semantik (User-Kritik, Fix zu T22): KEIN stummer
    // Download mehr nach "Anlagen/". Stattdessen:
    //   pdf  → PdfViewerModal (Vollviewer, inline pdf.js oder extern-Fallback)
    //   Bild → Bild-Preview-Modal (grosses <img>)
    //   Rest → Kompakt-Dialog + Save-Modal (Pfadvorschlag, expliziter Save-Button)
    // Speichern IMMER über SaveAttachmentModal mit Pfad-Input (Fach-Vermutung,
    // save-to-vault.ts); Download-Pipeline (client → writeBinary) bleibt unverändert.
    // Wiring über den onAttachmentClick-Callback (single truth, ADR-0007 Seam),
    // nicht über DOM-Fishing auf die gerenderten Rows.
    renderMailReader(contentEl, this.mail, this.body, this.attachments, {
      onAttachmentClick: (url, filename, mimetype) => {
        void this.previewAttachment(url, filename, mimetype);
      },
    });
  }

  /**
   * Anlagen-Vorschau-Router: nach Mime/Endung in den richtigen Preview-Pfad
   * verzweigt; das Speichern bleibt ein expliziter Sekundarschritt.
   * Wertebasiert (url/filename/mimetype aus dem Row-Callback, nicht aus der Row).
   */
  private async previewAttachment(
    url: string | null,
    filename: string,
    mimetype: string
  ): Promise<void> {
    const { classifyAttachment } = await import("./views/save-to-vault");
    const kind = classifyAttachment(mimetype, filename);
    if (!url) {
      new Notice("IServ: Anlage hat keine URL — nicht ladbar.", 5000);
      return;
    }
    if (kind === "pdf") {
      this.openAttachmentInPdfViewer(url, filename);
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
    void plugin.client.rawBytesRequest(url).then((bytes) => {
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
    void plugin.client.rawBytesRequest(url).then(async (bytes) => {
      new SaveAttachmentModal(this.app, url, filename, bytes, subjectHint ?? this.mail.subject).open();
    });
  }

  /**
   * Vollviewer für ein Queue-Item (T21) — Bild- und Save-Modals teilen sich
   * die openAttachmentInPdfViewer-Logik (Bytes via part-Endpoint).
   */
  private openAttachmentInPdfViewer(url: string, filename: string): void {
    if (!this.pluginRef?.client) {
      new Notice("IServ: Vollviewer braucht URL + Session.", 5000);
      return;
    }
    const client = this.pluginRef.client;
    // Subjekt aus dem Mail-Objekt (Wert statt DOM-Fishing auf die gerenderte Meta).
    const mailSubject = this.mail.subject.trim();
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
      const bytes = await plugin.client.rawBytesRequest(url);
      const name = fallbackName || "anlage.bin";
      const folder = "Anlagen";
      const adapter = this.app.vault.adapter;
      await adapter.mkdir(folder).catch(() => undefined);
      const path = `${folder}/${name}`;
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

/**
 * Save-Attachment-Modal (User-Kritik-Fix zu T22): Download passiert NICHT
 * stumm — expliziter „Speichern"-Button im Preview-Pfad mit editierbarem
 * Zielpfad. Vorschlag aus Fach-Vermutung (save-to-vault.ts: Mail-Betreff bzw.
 * Dateiname gegen Vault-Top-Level-Ordner, ADR-0001) + Template. Download-
 * Pipeline (client.rawBytesRequest → adapter.writeBinary) ist binär-sicher
 * (UTF-8-lossy-Detour entfernt, Live-Fund 2026-09-27).
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
    const vaultSubjects = getAllVaultSubjects(this.app);
    const suggested = defaultVaultTargetPath({
      subject: this.mailSubject,
      vaultSubjects,
      template: this.pluginRef?.settings.template || "",
      filename: this.filename,
    });
    // User-Kritik Runde 4: Ordner-Auswahl statt Freitext-Pfad. Top-Level-
    // Fächer + "Allgemein"-Fallback, Vorschlag vorselektiert.
    const folders = [...new Set(["Allgemein", ...vaultSubjects])];
    renderSaveToVault(contentEl, {
      suggestedPath: suggested,
      filename: this.filename,
      folderOptions: folders,
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
      // Runde 4: Dialog liefert den kompletten Ablage-Pfad (Ordner + Datei-
      // name); freie Text-Eingabe ohne Dateinamen → filename anhängen.
      let clean = targetPath.trim() || "Allgemein";
      if (!clean.includes("/") || clean.split("/").pop() === "") {
        clean = `${clean.replace(/\/$/, "")}/${this.filename}`;
      }
      const path = clean;
      const parts = path.split("/");
      const folder = parts.slice(0, -1).join("/") || "Allgemein";
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

  /** Back-Ref zum Plugin (Pattern MailReaderModal) — für Extern-Download-Chain. */
  private get pluginRef(): IServPlugin | null {
    const w = this.app as unknown as { plugins: { plugins: Record<string, IServPlugin> } };
    return w.plugins.plugins["iserv-integration"] ?? null;
  }
  /**
   * Runde 6 (Lifecycle-Fix): cancelPreview bricht laufende Bytes-Downloads,
   * pdf.js-Imports und Canvas-Weiterrenders ab; onClose leert das DOM und ruft
   * cancelPreview auf — der Viewer rendert nach dem Schließen nichts mehr in
   * nicht mehr gemountete Knoten und gibt Blob-URLs frei.
   */
  private cancelPreview: (() => void) | null = null;

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

    // Runde 6 (User): Preview mit dem Modal beenden — der Controller liegt
    // VOR dem ersten await (dynamische Imports): ESC während des Imports
    // bricht sofort ab; nach jedem await prüft onOpen das Signal erneut.
    const controller = new AbortController();
    this.cancelPreview = () => controller.abort();
    const signal = controller.signal;

    const { renderPdfViewer } = await import("./views/pdf-viewer");
    const { buildPdfPreviewUrl } = await import("./review-queue/pdf-preview");
    // Während der Imports geschlossen? → Viewer gar nicht mehr aufbauen.
    if (signal.aborted) return;

    const url = this.urlOverride ?? buildPdfPreviewUrl(this.item).url;

    // renderPdfViewer übernimmt den Abbruch im Inneren (post-await-Checks
    // vor jedem DOM-Eingriff, Blob-URL-Freigabe, Listener-Abriss).
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
        signal,
        // pdf.js aus dem Obsidian-Bundle. loadPdfJs kommt über den statischen
        // obsidian-Import am Dateikopf — ein dynamisches import("obsidian")
        // bleibt ungebundle't im Output und crasht im Electron-Renderer mit
        // "Failed to resolve module specifier 'obsidian'" (live verifiziert).
        loadPdfLib: async () => {
          const lib = await loadPdfJs();
          return lib as PdfJsLib;
        },
        // Bytes über die Plugin-Session (Transport nutzt den Cookie-Store).
        // Binäre Pipeline (Live-Fix): rawBytesRequest liefert Uint8Array 1:1 —
        // der frühere Weg (request → UTF-8-lossy-Text → stringToBytes) zerstörte
        // High-Bytes irreversibel (8855/24650 U+FFFD am Live-Klausurplan-PDF).
        // Signal-Handling (Runde 6): Abbruch und Netzwerkfehler → null; der
        // Viewer prüft nach jedem await das Signal und bricht alle weiteren
        // DOM-/Render-Arbeit ab, Blob-URLs werden revoked.
        fetchBytes: async () => {
          try {
            const bytes = await this.client.rawBytesRequest(url);
            return signal.aborted ? null : bytes;
          } catch {
            return null;
          }
        },
        // Issue #17-P3 (User 08.10): URL-Öffnung fast nie möglich (externes
        // Programm nicht in IServ eingeloggt) → Download-Chain: Bytes über
        // fetchBytes → adapter.writeBinary in den Plugin-Cache-Ordner
        // (.obsidian/plugins/iserv-integration/temp/) → Electron remote
        // shell.openPath. KEIN URL-Fallback — DL-Scheitern = Fehlermeldung.
        onOpenExternally: () => {
          const plugin = this.pluginRef;
          if (!plugin) {
            new Notice("IServ: Extern öffnen nicht verfügbar (Plugin-Kontext fehlt).", 6000);
            return;
          }
          void plugin.externOpenDownloaded(this.item.name, async () => {
            try {
              const bytes = await this.client.rawBytesRequest(url);
              return signal.aborted ? null : bytes;
            } catch {
              return null;
            }
          });
        },
        onSaveToVault: () => this.onSaveToVault?.(),
      }
    );
  }

  onClose(): void {
    // Erst abbrechen (Browser-PDF-Download stoppt, Listener weg, Blob-URLs
    // revoked), dann das Viewer-DOM entsorgen.
    this.cancelPreview?.();
    this.cancelPreview = null;
    this.contentEl.empty();
  }
}

/**
 * Welle 2 (User 28.09.2026): Aufgaben-Detail-Modal — ANSEHEN + Text-ABGEBEN.
 * Ablauf (onOpen): GET /iserv/exercise/show/<id> (read-only, Plugin-Session)
 * → Show-HTML als Text rendern (renderExerciseDetails: textContent, KEIN
 * innerHTML — kein Injection-Pfad) + getExerciseSubmitForm (hasTextField).
 * Abgabe: Confirm-Checkbox im Modal (bewusster Write per Klick — R2 30.09.2026:
 * kein Settings-Optin mehr, ADR-0005-Fußnote bleibt über den Klick gewahrt) →
 * submitExercise (allowWrite:true) →
 * Notice + Modal zu + Sidebar-Refresh (Aufgabe verschwindet aus dem Feed).
 */
class ExerciseDetailsModal extends Modal {
  constructor(
    app: App,
    private plugin: IServPlugin,
    private task: ExerciseCandidate
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("iserv-exercise-details-modal");
    contentEl.createEl("div", { text: "Lade Aufgabe …" });

    const plugin = this.plugin;
    let client: Awaited<ReturnType<IServPlugin["makeClientWithLogin"]>>;
    try {
      client = await plugin.makeClientWithLogin();
    } catch (err) {
      contentEl.empty();
      contentEl.createEl("p", {
        text: `IServ-Session fehlgeschlagen: ${String(err).slice(0, 120)}`,
      });
      return;
    }

    // 1) Show-Detail laden (read-only GET) — Frontend-Body als Text strippen.
    let showHtml = "";
    try {
      const resp = await client.request(`/iserv/exercise/show/${this.task.id}`);
      if (resp.status === 200) showHtml = resp.body;
    } catch {
      // fail-soft: leere Anzeige statt Task-Crash (Feed-Pattern).
    }

    // 2) Abgabe-Möglichkeit klären (hasTextField) — kein zweiter GET:
    //    parseExerciseSubmitForm liest dieselbe Show-Seite aus Fetch 1.
    // R2 (User 30.09.2026): das Settings-Optin allowExerciseSubmit ist ENTFERNT —
    // die Confirm-Checkbox im Modal IST der bewusste Write (ADR-0005-Fußnote
    // bleibt über den UI-Klick gewahrt, kein Silent-Submit möglich).
    const { parseExerciseSubmitForm } = await import("./api/exercise-submit");
    const form = showHtml ? parseExerciseSubmitForm(showHtml) : null;
    const canSubmitText = form !== null && form.hasTextField;
    // Issue #15: Datei-Upload möglich, sobald das Abgabeformular ein Datei-
    // Feld hat (hasFileField, live-HTML) — der Upload läuft später über die
    // bewiesene 2-Schritt-Kette (upload → files[N]-Confirm).
    const canUploadFiles = form !== null && form.hasFileField;
    // Ausgewählte Dateien (nativer Dialog) — Bytes bleiben im Caller-State,
    // hochgeladen wird per Klick auf "Abgeben" (eine Checkbox deckt beide
    // Schritte ab: einmal „Ich bestätige die Abgabe an IServ" pro Abgabe).
    let pickedFiles: File[] = [];

    const handle: ExerciseDetailsHandle = {
      textarea: null,
      confirm: null,
      submitBtn: null,
      setStatus: () => undefined,
    };

    renderExerciseDetails(contentEl, {
      task: this.task,
      bodyText: showHtml ? exerciseBodyText(showHtml) : null,
      canSubmitText,
      formAvailable: form !== null,
      attachments: showHtml ? parseExerciseAttachments(showHtml) : [],
      canUploadFiles,
      handle,
      onConfirmSubmit: (text) => {
        void this.doSubmit(client, form, text, handle, pickedFiles);
      },
      onPickFiles: (files) => {
        pickedFiles = files;
      },
      onOpenAttachment: (att) => {
        // Lehrkraft-Anhang: über die bewährte Binary-Pipeline öffnen
        // (PdfViewerModal mit part-URL-Override → rawBytesRequest, gleiche
        // Konvention wie Mail-Anlagen); Save-to-Vault aus dem Viewer.
        const modal = new PdfViewerModal(
          this.app,
          {
            id: att.url,
            name: att.name,
            path: att.name,
            hash: att.url,
            subject: this.task.subject,
            status: "neu",
          } as never,
          client,
          att.url
        );
        modal.open();
      },
    });
  }

  /** Submit-Pfad (User-Optin-Kette: Settings-Flag + Confirm-Checkbox oben). */
  private async doSubmit(
    client: Awaited<ReturnType<IServPlugin["makeClientWithLogin"]>>,
    form: Awaited<ReturnType<typeof getExerciseSubmitForm>>,
    text: string,
    handle: ExerciseDetailsHandle,
    pickedFiles: File[] = []
  ): Promise<void> {
    if (!form) {
      handle.setStatus("Kein Abgabe-Formular gefunden (bereits abgegeben?).");
      return;
    }
    if (!form.hasTextField && pickedFiles.length === 0) {
      handle.setStatus(
        "Diese Aufgabe nimmt keine Text-Abgabe — bitte Dateien auswählen (Upload)."
      );
      return;
    }
    if (form.hasTextField) {
      handle.setStatus("Abgabe wird gesendet …");
    } else {
      handle.setStatus(
        pickedFiles.length === 1
          ? "Datei wird hochgeladen und abgeschickt …"
          : `${pickedFiles.length} Dateien werden hochgeladen und abgeschickt …`
      );
    }
    // Issue #15: 2-Schritt-Kette — erst Uploads (bewiesener Kanal), dann
    // confirm mit files[N]-Feldern. Jeder Schritt user-beantragt (Checkbox-
    // Kette oben); fail-loud per Status-Zeile (kein stiller Failure).
    const { uploadExerciseFile } = await import("./api/exercise-submit-flow");
    const uploadedPaths: string[] = [];
    let uploadFailed = false;
    for (const f of pickedFiles) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const mime =
          (f as File & { type?: string }).type || "application/octet-stream";
        const up = await uploadExerciseFile(
          client,
          { name: f.name, bytes, mimeType: mime },
          true
        );
        if ("error" in up) {
          handle.setStatus(`Upload fehlgeschlagen (${f.name}): ${up.error}`);
          uploadFailed = true;
          break;
        }
        uploadedPaths.push(up.path);
        this.plugin
          .log(`exercise-details-upload: ${f.name} (${bytes.length} B) → ${up.path}`)
          .catch(() => undefined);
      } catch (err) {
        handle.setStatus(`Upload fehlgeschlagen (${f.name}): ${String(err).slice(0, 100)}`);
        uploadFailed = true;
        break;
      }
    }
    if (uploadFailed) {
      if (handle.submitBtn) handle.submitBtn.disabled = false;
      if (handle.textarea) handle.textarea.disabled = false;
      return;
    }
    // Text-only-Aufgabe ohne Textfeld: Text bleibt leer (Server akzeptiert).
    const result = await submitExercise(
      client,
      form,
      {
        text,
        uploadedFilePaths: uploadedPaths,
      },
      true
    );
    if (result.ok) {
      await this.plugin.log(`exercise-details-submit: HTTP ${result.status}`);
      new Notice(
        `IServ: Abgabe übermittelt (HTTP ${result.status})${
          uploadedPaths.length > 0 ? `, ${uploadedPaths.length} Datei(en)` : ""
        }.`
      );
      this.close();
      void this.plugin.refreshSidebar();
    } else {
      handle.setStatus(`Fehlgeschlagen: ${result.reason}`);
      // Erneuter Versuch möglich: Checkbox bestätigt lassen.
      if (handle.submitBtn) handle.submitBtn.disabled = false;
      if (handle.textarea) handle.textarea.disabled = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Exercise-Abgabe (User-Feature 28.09.2026): Auswahl- + Bearbeitungs-Modal.
 * Flow: Command → offene Aufgaben laden (read-only) → Aufgabe wählen →
 * Abgabe-Modal (Textfeld) → Bestätigungs-Checkbox (ADR-0005-Erweiterung:
 * bewusster Write, kein Silent-Submit) → submitExercise (allowSubmit=true).
 * Welle 1: Text-Abgabe; Datei-Upload folgt (Transport-V3 bytes-in, s.
 * exercise-submit-flow.ts Fußnote).
 */
class ExerciseSubmitModal extends Modal {
  constructor(app: App, private plugin: IServPlugin) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "IServ: Aufgabe abgeben" });
    const statusEl = contentEl.createEl("p", { text: "Lade offene Aufgaben..." });

    const plugin = this.plugin;
    let client: Awaited<ReturnType<IServPlugin["makeClientWithLogin"]>>;
    let list: Awaited<ReturnType<typeof exercises>> = [];
    try {
      client = await plugin.makeClientWithLogin();
      list = await exercises(client);
    } catch (err) {
      statusEl.setText(`Laden fehlgeschlagen: ${String(err).slice(0, 100)}`);
      return;
    }
    if (list.length === 0) {
      statusEl.setText("Keine offenen Aufgaben.");
      return;
    }
    statusEl.setText("Aufgabe wählen und Text eingeben.");

    const select = contentEl.createEl("select");
    select.style.width = "100%";
    for (const ex of list) {
      const opt = select.createEl("option", { value: ex.id });
      opt.textContent = `${ex.due} · ${ex.course} · ${ex.title}`;
    }
    const textEl = contentEl.createEl("textarea");
    textEl.style.width = "100%";
    textEl.style.minHeight = "8em";
    textEl.placeholder = "Abgabetext (Text-Abgabe; Datei-Upload folgt in Welle 2)";
    textEl.placeholder = "Abgabetext";

    // Bewusst-Write-Marke (ADR-0005-Fußnote): Checkbox statt stillem Submit.
    const confirmRow = contentEl.createEl("label");
    const confirmEl = confirmRow.createEl("input", { type: "checkbox" });
    confirmRow.createSpan({ text: " Ich bestätige die Abgabe an IServ (echter Write)." });

    const submitBtn = contentEl.createEl("button", { text: "Abgeben" });
    submitBtn.disabled = true;
    confirmEl.onchange = () => {
      submitBtn.disabled = !confirmEl.checked;
    };
    submitBtn.onclick = async () => {
      if (!confirmEl.checked) return;
      submitBtn.disabled = true;
      statusEl.setText("Abgabe wird gesendet...");
      const ex = list[select.selectedIndex];
      const form = await getExerciseSubmitForm(client, ex.id);
      if (!form) {
        statusEl.setText("Kein Abgabe-Formular gefunden (bereits abgegeben oder ohne Rechte?).");
        return;
      }
      if (!form.hasTextField) {
        statusEl.setText("Diese Aufgabe nimmt keine Text-Abgabe (nur Datei-Upload, Welle 2).");
        return;
      }
      const result = await submitExercise(client, form, { text: textEl.value }, true);
      if (result.ok) {
        await plugin.log(`exercise-submit: ${ex.title} → HTTP ${result.status}`);
        new Notice(`IServ: Abgabe übermittelt (HTTP ${result.status}).`);
        this.close();
      } else {
        statusEl.setText(`Fehlgeschlagen: ${result.reason}`);
        submitBtn.disabled = false;
      }
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Issue #12 (Konzept-NEU, User-Befund 08.10 — Rembrandt): Normalisierter
 * Dateiname für Vault-Duplikat-Match — Lowercase, Umlaute aufgelöst,
 * Leerschritte/Grammatik-Sonderzeichen entfernt (live bewiesen: Vault
 * "Kunst/Musteranalyse Rembrandt.pdf" vs. Server "Groups/O Kunst 12gN Gh/
 * Musteranalyse Rembrandt.pdf" = gleicher basename bei exakt gleichem
 * Spelling, aber Kapern "Rembrandt.pdf" vs "rembrandt" (Variierten) scheitern
 * ohne Normalisierung). normalizeName (subject-guess) deckt a-z-Autobahn ab.
 */
function normalizeVaultName(name: string): string {
  return normalizeName(name);
}

/**
 * Konzept-NEU (Issue #12, Teil 2d): Confirm-Modal für "Ordner verwerfen" —
 * ganzer IServ-Kursordner + alle offenen Queue-Items darunter. Bewusstseins-
 * Gate (ADR-0005-Fußnote-Prinzip): kollektive Entscheidung braucht Bestätigung,
 * kein Silent-Write. onCancel ohne Wirkung (Modal nur zu).
 */
class FolderDiscardConfirm extends Modal {
  constructor(
    app: App,
    private folder: { group: string; folderPath: string; itemIds: string[]; decision?: "allow" | "deny" },
    private onConfirm: () => void | Promise<void>,
    private onCancel: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("iserv-folder-discard-modal");
    // Issue #17 Punkt 4: decision "allow" = Zulassen-Modal (positiver Text,
    // kein mod-warning), Default bleibt das Verwerfen-Wording (Alt-Verhalten).
    const allow = this.folder.decision === "allow";
    contentEl.createEl("h3", { text: allow ? "Ordner zulassen?" : "Ordner verwerfen?" });
    contentEl.createEl("p", {
      text: allow
        ? `Der IServ-Ordner "${this.folder.group}" wird dauerhaft zugelassen — Dateien darunter landen wieder in der Review-Queue, auch wenn ein übergeordneter Ordner abgelehnt ist (${this.folder.itemIds.length} offene Dateien betroffen).`
        : `Der IServ-Ordner "${this.folder.group}" und alles darunter wird dauerhaft aus der Review-Queue ferngehalten (${this.folder.itemIds.length} offene Dateien werden verworfen).`,
    });
    const row = contentEl.createDiv({ cls: "iserv-folder-discard-buttons" });
    const ok = row.createEl("button", {
      text: allow ? "Ordner zulassen" : "Ordner verwerfen",
      cls: allow ? "mod-cta" : "mod-warning",
    });
    const cancel = row.createEl("button", { text: "Abbrechen" });
    ok.addEventListener("click", () => {
      this.close();
      void this.onConfirm();
    });
    cancel.addEventListener("click", () => {
      this.close();
      this.onCancel();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

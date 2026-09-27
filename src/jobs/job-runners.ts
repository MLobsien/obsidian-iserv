/**
 * JobModule-Faktory (T24, ADR-0005): die drei Module core/mails/exercises.
 *
 * Der JobRunner kennt keine Obsidian-API und keine konkreten Endpoints —
 * Host = Obsidian-Plugin (src/main.ts): stellt Client, Toggles (Settings)
 * und View-Refresh bereit, Intervalle kommen aus den Settings (jobIntervals).
 * Rate-Limit: geteilter Limiter im Client (RateLimiter.ts) — hier keine
 * Doppel-Logik; Fehler werden dezent an onError gemeldet (Erfolg still).
 */
import type { IServClient } from "../client/IServClient";
import { substitutions } from "../api/timetable";
import { mails, unreadCount } from "../api/mails";
import { exercises } from "../api/exercises";
import type { JobModule } from "./JobRunner";

/** Erfolg-/Fehler-Kanäle des Hosts (Modul-Name als Kontext). */
export type JobRefresh = (module: string) => void;

export interface JobModuleFactoryDeps {
  /** Logged-in-Client (Reuse/Re-Login-Logik lebt im Host). */
  getClient: () => Promise<IServClient>;
  /** core: Stundenplan + Vertretungen holen (View-Auffrischung im Host). */
  fetchCore: (client: IServClient) => Promise<void>;
  /** IServ-Mail-Konto = user@host (leer → Mails-Modul läuft nicht). */
  account: () => string;
  /** Spam-Filter-Settings (ADR-0008, onlySchoolEmails). */
  onlySchool: () => boolean;
  schoolHost: () => string;
  /** Toggles (live aus Settings). */
  coreToggle: () => boolean;
  mailsToggle: () => boolean;
  exercisesToggle: () => boolean;
}

/** core = Stundenplan + Vertretungen (View-Refresh macht der Host). */
function coreModule(deps: JobModuleFactoryDeps): JobModule {
  return {
    name: "core",
    intervalMin: 15,
    lastRun: null,
    toggle: deps.coreToggle,
    run: async () => {
      const client = await deps.getClient();
      await deps.fetchCore(client);
      await substitutions(client);
    },
  };
}

/** mails = Postfach-Liste (25) + Ungelesen-Zähler. */
function mailsModule(deps: JobModuleFactoryDeps): JobModule {
  return {
    name: "mails",
    intervalMin: 15,
    lastRun: null,
    toggle: deps.mailsToggle,
    run: async () => {
      const account = deps.account();
      if (!account) return; // kein Benutzer gesetzt → still nichts tun
      const client = await deps.getClient();
      await mails(client, account, 25, 0, {
        onlySchool: deps.onlySchool(),
        schoolHost: deps.schoolHost(),
      });
      await unreadCount(client, account);
    },
  };
}

/** exercises = Aufgaben-Übersicht (nicht Abgegebenes). */
function exercisesModule(deps: JobModuleFactoryDeps): JobModule {
  return {
    name: "exercises",
    intervalMin: 30,
    lastRun: null,
    toggle: deps.exercisesToggle,
    run: async () => {
      const client = await deps.getClient();
      await exercises(client);
    },
  };
}

export interface BuiltJobModules {
  core: JobModule;
  mails: JobModule;
  exercises: JobModule;
  /** Registry in Fälligkeits-Scan-Reihenfolge. */
  all: JobModule[];
}

/** Faktory: bindet die drei ADR-0005-Module an den Host. */
export function createJobModules(
  deps: JobModuleFactoryDeps
): BuiltJobModules {
  const core = coreModule(deps);
  const mails = mailsModule(deps);
  const exercises = exercisesModule(deps);
  return { core, mails, exercises, all: [core, mails, exercises] };
}

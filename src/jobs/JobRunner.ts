/**
 * Modularer JobRunner (T24, ADR-0005): eine Instanz pro JobModule.
 *
 * Zuständig je Modul: Fälligkeit (intervalMin), Toggle (Settings-Look),
 * lastRun-Anker, manueller Trigger und Fehler-Callback (Notice entscheidet
 * der Host — dezent, Erfolg still).
 *
 * Rate-Limit absichtlich KEIN Doppelaufbau: der geteilte Limiter lebt pro
 * Client-Request in src/client/RateLimiter.ts (sharedRateLimiter). Der
 * JobRunner leistet ausschließlich Modul-Sequenzierung: sharedJobSequence()
 * garantiert, dass nie zwei Module simultan laufen — keine überlappenden
 * Request-Bursts zwischen den Modulen.
 */

/** ms-Epoche oder null (Modul lief noch nie). */
export type LastRunStamp = number | null;

export const MS_PER_MINUTE = 60_000;

/**
 * Ein Modul = ein Datenfluss (ADR-0005-Registry: core/mails/exercises).
 * run/toggle stellt der Host bereit; lastRun schreibt der JobRunner.
 */
export interface JobModule {
  /** Stabiler Name = Settings-Key (jobIntervals.<name>) + Trigger-Id. */
  name: string;
  /** Intervall in Minuten; 0/min → Toggle false (Timer aus, Trigger bleibt). */
  intervalMin: number;
  /** Kompletter Modul-Lauf (Daten holen + Views befüllen). */
  run(): Promise<void>;
  /** An/Aus-Look (live aus Settings; false → Ticks werden übersprungen). */
  toggle(): boolean;
  /** Letzter Lauf-Anker (ms, bei Lauf-Start gesetzt); null = nie gelaufen. */
  lastRun: LastRunStamp;
}

/**
 * Fehler-Behandler: max. 1x pro fehlgeschlagenem Lauf. consecutive = Länge
 * der laufenden Fehler-Serie (1 = erster Fehler) — der Host kann Folge-Fehler
 * stiller behandeln (Session-Log-Pattern, ADR-0005).
 */
export type JobErrorHandler = (
  module: string,
  err: unknown,
  consecutive: number
) => void;

export interface JobRunnerDeps {
  module: JobModule;
  /** Uhr in ms; Default Date.now (Tests: vi.useFakeTimers). */
  now?: () => number;
  /** Modul-Sequenz; Default: prozessweiter Mutex (sharedJobSequence). */
  sequence?: <T>(task: () => Promise<T>) => Promise<T>;
  /** Fehler (Notice/Log im Host). */
  onError?: JobErrorHandler;
}

/**
 * Isolierter Modul-Mutex (FIFO): Aufgaben laufen nacheinander, niemals
 * überlappend. Tests erzeugen je Szenario eine Instanz; Produktion nutzt
 * sharedJobSequence (alle Runner eines Prozesses teilen sich die Kette).
 */
export function createJobSequence(): <T>(
  task: () => Promise<T>
) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task, task);
    chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

let sharedChain: Promise<unknown> = Promise.resolve();

/** Prozessweiter Mutex: nie 2 Module simultan (T24 "nie 2 Module simultan"). */
export function sharedJobSequence<T>(task: () => Promise<T>): Promise<T> {
  const result = sharedChain.then(task, task);
  sharedChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/** Kapselt genau ein JobModule: Fälligkeit, Toggle, Trigger, Fehler-Kanal. */
export class JobRunner {
  private readonly module: JobModule;
  private readonly now: () => number;
  private readonly sequence: <T>(task: () => Promise<T>) => Promise<T>;
  private readonly onError?: JobErrorHandler;
  /** Lauf-Schutz: derselbe Modul-Lauf drängelt nicht doppelt. */
  private running = false;
  /** Fehlerserie (Host: 1. Fehler Notice, Folge-Fehler nur Log). */
  private consecutiveErrors = 0;

  constructor(deps: JobRunnerDeps) {
    this.module = deps.module;
    this.now = deps.now ?? (() => Date.now());
    this.sequence = deps.sequence ?? sharedJobSequence;
    this.onError = deps.onError;
  }

  get name(): string {
    return this.module.name;
  }

  /** Fälligkeit: Toggle an UND (nie gelaufen ODER Intervall abgelaufen). */
  isDue(): boolean {
    if (!this.module.toggle()) return false;
    if (this.module.lastRun === null) return true;
    return this.now() - this.module.lastRun >= this.module.intervalMin * MS_PER_MINUTE;
  }

  /**
   * Interval-Tick (Obsidian: Plugin registerInterval pro Job). Läuft nur bei
   * Fälligkeit; während eines laufenden Laufs wird nicht nachgedrängelt.
   */
  tick(): Promise<void> {
    if (this.running) return Promise.resolve();
    if (!this.isDue()) return Promise.resolve();
    return this.execute();
  }

  /** Manueller Trigger ('IServ sync: …'): unabhängig von Fälligkeit/Toggle. */
  trigger(): Promise<void> {
    if (this.running) return Promise.resolve();
    return this.execute();
  }

  /** Optionaler stiller Sofort-Tick beim Aktivieren (z. B. nach Login). */
  start(): Promise<void> {
    return this.tick();
  }

  private execute(): Promise<void> {
    this.running = true;
    // lastRun-Anker = Lauf-Start (nicht -Ende): Intervall zwischen Starts.
    this.module.lastRun = this.now();
    const task = async (): Promise<void> => {
      try {
        await this.module.run();
        this.consecutiveErrors = 0;
      } catch (err) {
        this.consecutiveErrors++;
        this.onError?.(this.module.name, err, this.consecutiveErrors);
      } finally {
        this.running = false;
      }
    };
    let queued: Promise<void>;
    try {
      queued = this.sequence(task);
    } catch (err) {
      // Sequencer selbst defekt (sollte nie passieren): State freigeben.
      this.running = false;
      this.consecutiveErrors++;
      this.onError?.(this.module.name, err, this.consecutiveErrors);
      return Promise.resolve();
    }
    return queued.then(
      () => undefined,
      () => undefined
    );
  }
}

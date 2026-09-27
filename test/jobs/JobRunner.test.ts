/**
 * JobRunner-Tests (T24, ADR-0005): Modul-Fälligkeit, Toggle-Verhalten,
 * manuelle Trigger, Fehler-Kanal (dezent) und Sequenzierung (nie 2 Module
 * simultan). Fake Timers steuern die Uhr; async Läufe per flushed Promises.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  JobRunner,
  JobModule,
  createJobSequence,
  sharedJobSequence,
  MS_PER_MINUTE,
} from "../../src/jobs/JobRunner";
import { createJobModules } from "../../src/jobs/job-runners";
import type { IServClient } from "../../src/api/shared-client";

/** Microtask-Queue leerlaufen lassen (fake timers + async kombinieren). */
async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function makeModule(
  overrides: Partial<JobModule> = {}
): JobModule {
  return {
    name: "core",
    intervalMin: 15,
    lastRun: null,
    toggle: () => true,
    run: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Fälligkeit (Modul-Fälligkeit)", () => {
  it("läuft beim ersten Tick (lastRun = null)", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const module = makeModule({ run });
    const runner = new JobRunner({ module });

    expect(runner.isDue()).toBe(true);
    await runner.tick();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(module.lastRun).toBe(0);
  });

  it("läuft nicht vor Ablauf des Intervalls", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const module = makeModule({ run, intervalMin: 15, lastRun: 0 });
    const runner = new JobRunner({ module });

    // +14:59 → nicht fällig
    vi.setSystemTime(15 * MS_PER_MINUTE - 1);
    expect(runner.isDue()).toBe(false);
    await runner.tick();
    await flush();
    expect(run).not.toHaveBeenCalled();

    // +15:00 → fällig
    vi.setSystemTime(15 * MS_PER_MINUTE);
    expect(runner.isDue()).toBe(true);
    await runner.tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(module.lastRun).toBe(15 * MS_PER_MINUTE);
  });

  it("Intervall-Grenze: exakt intervalMin gilt als fällig (>=)", async () => {
    const module = makeModule({ intervalMin: 30, lastRun: 0 });
    const runner = new JobRunner({ module });
    vi.setSystemTime(30 * MS_PER_MINUTE - 1);
    expect(runner.isDue()).toBe(false);
    vi.setSystemTime(30 * MS_PER_MINUTE);
    expect(runner.isDue()).toBe(true);
  });
});

describe("Toggle-Verhalten", () => {
  it("Toggle aus → Tick läuft nicht (auch nicht bei lastRun = null)", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const module = makeModule({ run, toggle: () => false });
    const runner = new JobRunner({ module });

    expect(runner.isDue()).toBe(false);
    await runner.tick();
    await flush();

    expect(run).not.toHaveBeenCalled();
    expect(module.lastRun).toBeNull();
  });

  it("Toggle aus → manueller Trigger läuft trotzdem (Schnellsync)", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const module = makeModule({ run, toggle: () => false });
    const runner = new JobRunner({ module });

    await runner.trigger();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(module.lastRun).not.toBeNull();
  });

  it("intervalMin = 0 + Toggle an (Settings 0 = aus via Host-Toggle) — Fälligkeit folgt dem Toggle", () => {
    let on = true;
    const module = makeModule({ toggle: () => on, intervalMin: 0 });
    const runner = new JobRunner({ module });
    expect(runner.isDue()).toBe(true); // toggle entscheidet, nicht intervalMin
    on = false;
    expect(runner.isDue()).toBe(false);
  });
});

describe("manueller Trigger", () => {
  it("Trigger läuft unabhängig von Fälligkeit", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const module = makeModule({ run, lastRun: 0 });
    const runner = new JobRunner({ module });
    vi.setSystemTime(1000); // gerade erst gelaufen → nicht fällig

    await runner.trigger();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(module.lastRun).toBe(1000);
  });

  it("läufender Trigger wird nicht nachgedrängelt (Zweit-Trigger no-op)", async () => {
    let releaseRun!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const run = vi.fn().mockImplementation(() => gate);
    const module = makeModule({ run });
    const runner = new JobRunner({ module });

    const first = runner.trigger();
    const second = runner.trigger(); // läuft noch → no-op
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    releaseRun();
    await Promise.all([first, second]);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("Fehler-Kanal (dezent, ADR-0005 Session-Log-Pattern)", () => {
  it("Fehler im run → onError genau 1x, kein Throw nach außen", async () => {
    const run = vi.fn().mockRejectedValue(new Error("netz weg"));
    const onError = vi.fn();
    const runner = new JobRunner({
      module: makeModule({ run }),
      onError,
    });

    await expect(runner.tick()).resolves.toBeUndefined();
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("core", expect.any(Error), 1);
  });

  it("Erfolg resettet die Fehlerserie", async () => {
    let fail = true;
    const run = vi.fn().mockImplementation(async () => {
      if (fail) throw new Error("x");
    });
    const onError = vi.fn();
    const runner = new JobRunner({
      module: makeModule({ run, lastRun: 0 }),
      onError,
    });

    vi.setSystemTime(15 * MS_PER_MINUTE);
    await runner.tick();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);

    fail = false;
    vi.setSystemTime(30 * MS_PER_MINUTE);
    await runner.tick();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1); // kein weiterer Fehler-Call

    fail = true;
    vi.setSystemTime(45 * MS_PER_MINUTE);
    await runner.tick();
    await flush();
    expect(onError).toHaveBeenLastCalledWith("core", expect.any(Error), 1);
  });

  it("onError ohne Handler: Lauf läuft trotzdem weiter (Erfolg still)", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const runner = new JobRunner({ module: makeModule({ run }) });
    await expect(runner.tick()).resolves.toBeUndefined();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("Sequenzierung (nie 2 Module simultan)", () => {
  it("createJobSequence: Aufgaben laufen nacheinander", async () => {
    const seq = createJobSequence();
    const events: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));

    const a = seq(async () => {
      events.push("a-start");
      await gateA;
      events.push("a-end");
    });
    const b = seq(async () => {
      events.push("b-start");
      events.push("b-end");
    });

    await flush();
    expect(events).toEqual(["a-start"]); // b wartet

    releaseA();
    await Promise.all([a, b]);
    await flush();
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("Fehler in der Kette blockieren keine nachfolgenden Aufgaben", async () => {
    const seq = createJobSequence();
    const runB = vi.fn().mockResolvedValue(undefined);
    await expect(
      seq(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await seq(runB);
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it("Runner teilen sharedJobSequence: gleichzeitige Ticks überlappen nicht", async () => {
    const events: string[] = [];
    let releaseCore!: () => void;
    const gateCore = new Promise<void>((r) => (releaseCore = r));

    const core = new JobRunner({
      module: makeModule({
        name: "core",
        run: async () => {
          events.push("core-start");
          await gateCore;
          events.push("core-end");
        },
      }),
    });
    const mails = new JobRunner({
      module: makeModule({
        name: "mails",
        run: async () => {
          events.push("mails-start");
          events.push("mails-end");
        },
      }),
    });

    const p1 = core.tick();
    const p2 = mails.tick();
    await flush();

    expect(events).toEqual(["core-start"]); // mails wartet auf core

    releaseCore();
    await Promise.all([p1, p2]);
    await flush();
    expect(events).toEqual(["core-start", "core-end", "mails-start", "mails-end"]);
  });
});

describe("Tick-/Intervall-Verhalten mit fake timers", () => {
  it("Tick kurz nach einem Lauf ist ein No-op (running + lastRun)", async () => {
    let releaseRun!: () => void;
    const gate = new Promise<void>((r) => (releaseRun = r));
    const run = vi.fn().mockImplementation(() => gate);
    const module = makeModule({ run });
    const runner = new JobRunner({ module });

    const first = runner.tick(); // lastRun null → läuft
    const second = runner.tick(); // läuft noch → no-op
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    releaseRun();
    await first;
    await second;
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lastRun-Anker ist Lauf-Start: langer Lauf verschiebt den nächsten Start nicht", async () => {
    let releaseRun!: () => void;
    const gate = new Promise<void>((r) => (releaseRun = r));
    const run = vi.fn().mockImplementation(() => gate);
    const module = makeModule({ run, intervalMin: 15, lastRun: null });
    const runner = new JobRunner({ module });

    const first = runner.tick(); // Start bei t=0
    vi.setSystemTime(20 * MS_PER_MINUTE); // Lauf dauert 20 min (über Intervall)
    releaseRun();
    await first;
    await flush();

    // lastRun = 0 (Start), nicht 20 min (Ende) → bei t=15 wäre er fällig gewesen
    expect(module.lastRun).toBe(0);
    expect(runner.isDue()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// job-runners.ts-Faktory: Module rufen die richtigen API-Aufrufe
// (Fake-Clients, keine Netze; API-Module schlucken Fehler → keine Throws).
// ---------------------------------------------------------------------------

function fakeClient(): IServClient {
  return {
    request: vi.fn().mockResolvedValue({ status: 200, headers: {}, body: "[]" }),
  } as unknown as IServClient;
}

describe("createJobModules (Faktory)", () => {
  it("core ruft fetchCore (timetable+subs macht der Host)", async () => {
    const fetchCore = vi.fn().mockResolvedValue(undefined);
    const modules = createJobModules({
      getClient: () => Promise.resolve(fakeClient()),
      fetchCore,
      account: () => "user@gymmeck.de",
      onlySchool: () => true,
      schoolHost: () => "gymmeck.de",
      coreToggle: () => true,
      mailsToggle: () => true,
      exercisesToggle: () => true,
    });

    await modules.core.run();
    expect(fetchCore).toHaveBeenCalledTimes(1);
  });

  it("mails ruft mails + unreadCount mit user@host", async () => {
    const client = fakeClient();
    const spy = vi.spyOn(client, "request");
    const modules = createJobModules({
      getClient: () => Promise.resolve(client),
      fetchCore: vi.fn().mockResolvedValue(undefined),
      account: () => "max@gymmeck.de",
      onlySchool: () => true,
      schoolHost: () => "gymmeck.de",
      coreToggle: () => true,
      mailsToggle: () => true,
      exercisesToggle: () => true,
    });

    await modules.mails.run();
    const paths = spy.mock.calls.map((c) => c[0]);
    expect(paths.some((p) => p.includes("account/max@gymmeck.de/message"))).toBe(true);
    expect(paths.some((p) => p.includes("flag[seen]=false"))).toBe(true);
  });

  it("mails ohne account (kein user gesetzt): stiller No-op ohne Client", async () => {
    const getClient = vi.fn().mockResolvedValue(fakeClient());
    const modules = createJobModules({
      getClient,
      fetchCore: vi.fn().mockResolvedValue(undefined),
      account: () => "",
      onlySchool: () => true,
      schoolHost: () => "gymmeck.de",
      coreToggle: () => true,
      mailsToggle: () => true,
      exercisesToggle: () => true,
    });

    await modules.mails.run();
    expect(getClient).not.toHaveBeenCalled();
  });

  it("exercises ruft /iserv/exercise", async () => {
    const client = fakeClient();
    const spy = vi.spyOn(client, "request");
    const modules = createJobModules({
      getClient: () => Promise.resolve(client),
      fetchCore: vi.fn().mockResolvedValue(undefined),
      account: () => "user@gymmeck.de",
      onlySchool: () => true,
      schoolHost: () => "gymmeck.de",
      coreToggle: () => true,
      mailsToggle: () => true,
      exercisesToggle: () => true,
    });

    await modules.exercises.run();
    expect(spy.mock.calls[0][0]).toBe("/iserv/exercise");
  });

  it("Registry: Default-Intervalle core/mails 15, exercises 30; Namen stabil", () => {
    const modules = createJobModules({
      getClient: () => Promise.resolve(fakeClient()),
      fetchCore: vi.fn().mockResolvedValue(undefined),
      account: () => "",
      onlySchool: () => true,
      schoolHost: () => "gymmeck.de",
      coreToggle: () => true,
      mailsToggle: () => true,
      exercisesToggle: () => true,
    });

    expect(modules.core.name).toBe("core");
    expect(modules.core.intervalMin).toBe(15);
    expect(modules.mails.name).toBe("mails");
    expect(modules.mails.intervalMin).toBe(15);
    expect(modules.exercises.name).toBe("exercises");
    expect(modules.exercises.intervalMin).toBe(30);
    expect(modules.all.map((m) => m.name)).toEqual(["core", "mails", "exercises"]);
  });
});

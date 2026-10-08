import { describe, it, expect, vi } from "vitest";
import {
  fetchCurrentTimetable,
  isOnVacation,
  schoolDaysOfWeek,
  splitSubstitution,
  jsonEntriesToSubstitutions,
  displayTeacherName,
  jsonFreeSlots,
  fetchJsonDay,
  filesFolderNameForCourse,
  substUnionById,
  type JsonSubstitutionEntry,
  type Vacation,
} from "../../src/api/timetable-json";
import type { TimetableEntry } from "../../src/api/timetable";

function lesson(id: number, weekday: number, slot: number, subject: string, course: string): TimetableEntry {
  return {
    id,
    courseSubject: {
      teachers: [{ displayname: "Schulz Kathrin", externalId: "Sz" }],
      subject: { name: subject, acronym: subject.slice(0, 2), hexColor: "#000" },
      course: { id: 1, name: course, externalId: "x", type: "course" },
    },
    weekday,
    timeTableSlot: { id: slot, number: slot, startTime: "08:00", endTime: "08:45", type: "lesson" },
    room: { id: 1, name: "27" },
  } as TimetableEntry;
}

/**
 * Live-Form (29.09.2026 Ergebnisseite): Vertretungs-Entry mit
 * `courseSubject.subject = null`, empty teachers + originalTimeTableEntry.
 */
function substEntry(opts: {
  id: number;
  weekday: number;
  slot: number;
  course: string;
  subject: string;
  type?: "substituted" | "class-absence";
}): JsonSubstitutionEntry {
  return {
    id: opts.id,
    substitution: { id: opts.id + 9000, sourceOfCreation: "Untis" },
    originalTimeTableEntry: lesson(opts.id, opts.weekday, opts.slot, opts.subject, opts.course),
    timeTableSlot: { id: opts.slot, number: opts.slot, startTime: "08:00", endTime: "08:45", type: "lesson" },
    courseSubject: {
      type: "lesson",
      course: { id: 1, name: opts.course, externalId: "x", type: "course" },
      subject: null,
      teachers: [{ displayname: "", surname: "", forename: "", externalId: "" }],
    } as JsonSubstitutionEntry["courseSubject"],
    weekday: opts.weekday,
    room: { id: 2, name: "72" },
    changedParts: { room: false, teachers: false, subject: true },
    timetableBlock: null,
    substitutionType: opts.type ?? "substituted",
    message: "",
  } as JsonSubstitutionEntry;
}

function makeClient(body: unknown | string, status = 200) {
  const mock = vi.fn().mockResolvedValue({
    status,
    headers: {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { client: { request: mock } as never, mock };
}

const LIVE_BODY = {
  entries: [
    lesson(20613565, 0, 3, "Latein", "O Latein 12gN Sz"),
    substEntry({ id: 1, weekday: 3, slot: 1, course: "O Chemie 12eN Hn", subject: "Chemie" }),
  ],
  vacations: [{ id: 51613, name: "Tag der Deutschen Einheit", startDate: "2026-10-03", endDate: "2026-10-03" }],
  schoolEvents: [],
};

describe("timetable-json — fetchCurrentTimetable (aktuelle Form, Live-Body-Verfremdung)", () => {
  it("200 + {entries, vacations, schoolEvents} path: shape ifgtты to proper types", async () => {
    const { client, mock } = makeClient(LIVE_BODY);
    const r = await fetchCurrentTimetable(client, "2026-09-29");
    expect(r).not.toBeNull();
    expect(r!.entries.length).toBe(2);
    expect(r!.vacations.length).toBe(1);
    expect(mock).toHaveBeenCalledWith(
      "/iserv/dieschulapp/api/1.0/current-timetable/?date=2026-09-29&week=true&substitutions=true"
    );
  });

  it("week=false fetches without week=true param", async () => {
    const { client, mock } = makeClient(LIVE_BODY);
    await fetchCurrentTimetable(client, "2026-09-29", { week: false });
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining("week=false")
    );
  });

  it("best-effort: non-200 → null (wirft nie)", async () => {
    const { client } = makeClient("denied", 401);
    expect(await fetchCurrentTimetable(client, "2026-09-29")).toBeNull();
  });

  it("best-effort: broken JSON → null", async () => {
    const { client } = makeClient("<html>404 asm</html>");
    expect(await fetchCurrentTimetable(client, "2026-09-29")).toBeNull();
  });

  it("payload ohne entries-Array (top-level objekt nicht erkannt) → null", async () => {
    const { client } = makeClient({ foo: 1 });
    expect(await fetchCurrentTimetable(client, "2026-09-29")).toBeNull();
  });

  it("Netzwerkwurf → null", async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) } as never;
    expect(await fetchCurrentTimetable(client, "2026-09-29")).toBeNull();
  });
});

describe("timetable-json — isOnVacation / schoolDaysOfWeek (Reichweite Befund R1)", () => {
  const vacations: Vacation[] = [
    { id: 1, name: "Herbstferien", startDate: "2026-10-12", endDate: "2026-10-24" },
    { id: 2, name: "Weihnachtsferien", startDate: "2026-12-23", endDate: "2027-01-09" },
  ];

  it("Ferientag erkannt (in [start,end], inklusive Randtage)", () => {
    expect(isOnVacation("2026-10-12", vacations)).toBe(true);
    expect(isOnVacation("2026-12-28", vacations)).toBe(true); // Weihnachtsferien Woche wie Live-JSON
    expect(isOnVacation("2027-01-09", vacations)).toBe(true); // endDate inklusiv
  });

  it("Schultag nicht als Ferien markiert", () => {
    expect(isOnVacation("2026-09-29", vacations)).toBe(false);
    expect(isOnVacation("2026-10-06", vacations)).toBe(false);
  });

  it("schoolDaysOfWeek filtert Ferientage aus einer weekday→ISO-Menge", () => {
    const weekIso = new Map([
      [0, "2026-10-12"],
      [1, "2026-10-13"],
      [4, "2026-10-16"],
    ]);
    expect(schoolDaysOfWeek(weekIso, vacations)).toEqual([]); // ganze Ferienwoche
    const normal = new Map([
      [0, "2026-09-28"],
      [1, "2026-09-29"],
    ]);
    expect(schoolDaysOfWeek(normal, vacations)).toEqual([0, 1]);
  });
});

describe("timetable-json — splitSubstitution (Ausfälle im JSON: leeres Fach, R3)", () => {
  it("Live-Form: subject=null + substitutionType → {original (echtes Fach), type}", () => {
    const e = substEntry({ id: 7906795, weekday: 3, slot: 1, course: "O Chemie 12eN Hn", subject: "Chemie" });
    const r = splitSubstitution(e);
    expect(r).not.toBeNull();
    // Issue #18: NULL-Fach + leere teachers = "-"-Fall → class-absence
    expect(r!.type).toBe("class-absence");
    expect(r!.original?.courseSubject?.subject?.name).toBe("Chemie");
    expect(r!.original?.courseSubject?.course?.name).toBe("O Chemie 12eN Hn");
  });

  it("class-absence (Entfall) erkannt", () => {
    const e = substEntry({ id: 1, weekday: 2, slot: 5, course: "O Mathe 12eN Kü", subject: "Mathematik", type: "class-absence" });
    expect(splitSubstitution(e)!.type).toBe("class-absence");
  });

  it("normale Lesson (kein substitutionType) → null (KEIN Phantom-Decor)", () => {
    expect(splitSubstitution(lesson(1, 0, 1, "Latein", "O Latein 12gN Sz") as JsonSubstitutionEntry)).toBeNull();
  });

  it("substituted OHNE originalTimeTableEntry → original null (kein Crash)", () => {
    const e = substEntry({ id: 1, weekday: 3, slot: 1, course: "X", subject: "Y" });
    delete (e as { originalTimeTableEntry?: unknown }).originalTimeTableEntry;
    const r = splitSubstitution(e);
    expect(r!.original).toBeNull();
  });
});

describe("timetable-json — jsonEntriesToSubstitutions (Bridge ins sidebar-Decor)", () => {
  it("wandelt JSON-Substituton ein Substitution um: hour=slot, courseName=original course, original-Fach in originalSubject", () => {
    const e = substEntry({ id: 7906795, weekday: 3, slot: 1, course: "O Chemie 12eN Hn", subject: "Chemie" });
    (e as { _iso?: string })._iso = "2026-09-30";
    const s = jsonEntriesToSubstitutions([e]);
    expect(s.length).toBe(1);
    // Issue #18: NULL-Fach + leere teachers = "-"-Fall → class-absence
    expect(s[0]!.substitutionType).toBe("class-absence");
    expect(s[0]!.hour).toBe(1);
    expect(s[0]!.courseName).toBe("O Chemie 12eN Hn");
    expect(s[0]!.date.date).toContain("2026-09-30");
    // room substituiert = top-level room (72, Objekt-Form wie live)
    expect(s[0]!.room).toEqual({ id: 2, name: "72" });
    // Erweiterungs-Felder: echtes Fach aus dem Original
    expect((s[0] as unknown as { originalSubject: string }).originalSubject).toBe("Chemie");
  });

  it("normale Lessons fliegen raus (kein Collect von Phantom-Dekoren)", () => {
    const s = jsonEntriesToSubstitutions([lesson(1, 0, 1, "Latein", "O Latein 12gN Sz") as JsonSubstitutionEntry]);
    expect(s).toEqual([]);
  });

  // Issue #13 (live 08.10.2026): NULL-Fach-Subst-Entries — Fach/Slot/Kurs
  // aus dem originalTimeTableEntry, nie leeres Fach in der Bridge.
  describe("Issue #13 — NULL-Fach-Entries (Fach aus originalTimeTableEntry)", () => {
    it("substituted mit subject=NULL: subject aus Original, hour/courseName Original, insteadOfTeacher Original-Lehrer", () => {
      const e = substEntry({ id: 8225001, weekday: 2, slot: 3, course: "O Englisch 12gN Ha", subject: "Englisch" });
      (e as { _iso?: string })._iso = "2026-10-07";
      const s = jsonEntriesToSubstitutions([e]);
      expect(s.length).toBe(1);
      expect(s[0]!.subject).toBe("Englisch"); // KEIN leeres Fach
      expect(s[0]!.hour).toBe(3);
      expect(s[0]!.courseName).toBe("O Englisch 12gN Ha");
      expect(s[0]!.substitutionType).toBe("class-absence"); // Issue #18: NULL-Fach+leere-teachers = "-"-Fall
      expect((s[0] as unknown as { originalSubject: string }).originalSubject).toBe("Englisch");
      expect(s[0]!.insteadOfTeacher?.displayname).toBe("Schulz Kathrin");
    });

    it("substituted mit NULL-Fach OHNE originalTimeTableEntry: fail-soft, Fach bleibt leer (kein Crash)", () => {
      const e = substEntry({ id: 1, weekday: 2, slot: 3, course: "X", subject: "Y" });
      delete (e as { originalTimeTableEntry?: unknown }).originalTimeTableEntry;
      // subject bleibt NULL im Entry (kein Original, kein Fach verfügbar)
      const raw = { ...e, courseSubject: { ...e.courseSubject, subject: null } };
      const s = jsonEntriesToSubstitutions([raw as JsonSubstitutionEntry]);
      expect(s.length).toBe(1);
      expect(s[0]!.subject).toBe("");
      expect(s[0]!.hour).toBe(3);
    });

    it("'canceled' (live 08.10.2026, Fach gefüllt) → class-absence-Dekor mit Original-Daten", () => {
      const e = substEntry({ id: 8227000, weekday: 0, slot: 5, course: "O Mathe 12eN Kü", subject: "Mathematik" });
      (e as { _iso?: string; substitutionType?: unknown }).substitutionType = "canceled";
      (e as { _iso?: string })._iso = "2026-10-05";
      const s = jsonEntriesToSubstitutions([e]);
      expect(s.length).toBe(1);
      expect(s[0]!.substitutionType).toBe("class-absence");
      expect(s[0]!.subject).toBe("Mathematik");
      expect(s[0]!.courseName).toBe("O Mathe 12eN Kü");
    });
  });

  // Issue #18 (live 08.10.2026, Latein 5/6): substituted + subject===NULL +
  // teachers [""] = der IServ-"-"-Fall = AUSFALL → class-absence-Dekor (rot,
  // „· Entfall"), NICHT Orange-Vertretung. Nur die NULL-Fach-Teilmenge:
  // echte Vertretungen (Ersatzfach ODER benannter Ersatzlehrer) bleiben substituted.
  describe("Issue #18 — substituted+NULL-Fach+leere-Lehrer = Entfall", () => {
    it("substituted mit subject=NULL + teachers ['']: → class-absence (Fach bleibt aus Original)", () => {
      const e = substEntry({ id: 8231001, weekday: 3, slot: 5, course: "O Latein 12gN Sz", subject: "Latein" });
      (e as { _iso?: string })._iso = "2026-10-08";
      const s = jsonEntriesToSubstitutions([e]);
      expect(s.length).toBe(1);
      expect(s[0]!.substitutionType).toBe("class-absence");
      // Fach/Slot/Kurs kommen weiterhin aus dem Original (Issue-#13-Pfad bleibt)
      expect(s[0]!.subject).toBe("Latein");
      expect(s[0]!.courseName).toBe("O Latein 12gN Sz");
    });

    it("same shape via splitSubstitution: type class-absence statt substituted", () => {
      const e = substEntry({ id: 1, weekday: 3, slot: 5, course: "O Latein 12gN Sz", subject: "Latein" });
      expect(splitSubstitution(e)!.type).toBe("class-absence");
      expect(splitSubstitution(e)!.original?.courseSubject?.subject?.name).toBe("Latein");
    });

    it("substituted mit subject=NULL + BENANNTEM teacher → substituted (Ersatzlehrer-Kante, kein False-Positive)", () => {
      const e = substEntry({ id: 1, weekday: 3, slot: 5, course: "O Latein 12gN Sz", subject: "Latein" });
      (e.courseSubject! as { teachers: unknown }).teachers = [
        { displayname: "Neumann Vera", surname: "Neumann", forename: "Vera", externalId: "Nv" },
      ];
      const s = jsonEntriesToSubstitutions([e]);
      expect(s.length).toBe(1);
      expect(s[0]!.substitutionType).toBe("substituted");
    });

    it("substituted mit GESETZTEM Ersatzfach → substituted (echte Vertretung, kein False-Positive)", () => {
      const e = substEntry({ id: 2, weekday: 3, slot: 6, course: "O Latein 12gN Sz", subject: "Latein" });
      // Ersatzfach gesetzt (Live-Form: Vertretung mit Ersatzfach hat subject)
      (e.courseSubject! as { subject: { name: string } | null }).subject = {
        name: "Mathematik", acronym: "Ma", hexColor: "#000",
      } as never;
      const s = jsonEntriesToSubstitutions([e]);
      expect(s.length).toBe(1);
      expect(s[0]!.substitutionType).toBe("substituted");
      expect(s[0]!.subject).toBe("Mathematik");
    });

    it("teachers undefined → zählt als leer (Entfall-Kante, fail-soft)", () => {
      const e = substEntry({ id: 3, weekday: 3, slot: 5, course: "O Latein 12gN Sz", subject: "Latein" });
      (e.courseSubject! as { teachers: unknown }).teachers = undefined;
      expect(jsonEntriesToSubstitutions([e])[0]!.substitutionType).toBe("class-absence");
    });

    it("voller Original-Durchlauf: beide NULL-Fach-Substs in einem Payload → absence, echte Subst bleibt substituted", () => {
      const absence = substEntry({ id: 11, weekday: 3, slot: 5, course: "O Latein 12gN Sz", subject: "Latein" });
      const real = substEntry({ id: 12, weekday: 3, slot: 6, course: "O Chemie 12eN Hn", subject: "Chemie" });
      (real.courseSubject! as { subject: { name: string } | null }).subject = {
        name: "Physik", acronym: "Ph", hexColor: "#000",
      } as never;
      const s = jsonEntriesToSubstitutions([absence, real]);
      expect(s[0]!.substitutionType).toBe("class-absence");
      expect(s[1]!.substitutionType).toBe("substituted");
    });
  });
});

describe("timetable-json — fetchJsonDay (Tagmodus ohne week=true)", () => {
  it("day fetch liefert Entries + vacation-Flag", async () => {
    const { client } = makeClient(LIVE_BODY);
    const d = await fetchJsonDay(client, "2026-09-29");
    expect(d).not.toBeNull();
    expect(d!.entries.length).toBe(2);
    expect(d!.vacation).toBe(false);
  });

  it("Ferien-Tage tragen vacation=true (kein Unterdruck in data-Schicht)", async () => {
    const { client } = makeClient({
      entries: [lesson(1, 0, 1, "Latein", "O Latein 12gN Sz")],
      vacations: [{ id: 1, name: "Sommerferien", startDate: "2026-07-02", endDate: "2026-08-12" }],
      schoolEvents: [],
    });
    const d = await fetchJsonDay(client, "2026-07-15");
    expect(d!.vacation).toBe(true);
    // Entries bleiben in der Daten-Schicht (Template); Views dürfen über
    // vacation-Flag "Ferien" rendern — kein Client-Verlust (Zukunftssicher).
    expect(d!.entries.length).toBe(1);
  });
});

describe("timetable-json — filesFolderNameForCourse (R2 Gruppenordner-Anker)", () => {
  it("Kursname IS der Files-Ordnername (live: O Latein 12gN Sz ↔ Groups/O Latein 12gN Sz/)", () => {
    expect(filesFolderNameForCourse("O Latein 12gN Sz")).toBe("O Latein 12gN Sz");
    expect(filesFolderNameForCourse("O Chemie 12eN Hn")).toBe("O Chemie 12eN Hn");
  });

  it("leer/undefined → leerer String (kein Rage-Crash)", () => {
    expect(filesFolderNameForCourse(undefined)).toBe("");
    expect(filesFolderNameForCourse("  ")).toBe("");
  });

  it("subjectFromGroup akzeptiert Kursnamen (Bridge zum Review-Queue-Fachvorschlag)", async () => {
    const { subjectFromGroup } = await import("../../src/review-queue/subject-guess");
    expect(subjectFromGroup("O Latein 12gN Sz")).toBe("Latein");
    expect(subjectFromGroup("O Mathe 12eN Kü")).toBe("Mathematik");
  });
});

describe("timetable-json — jsonEntriesToSubstitutions weekIso (Issue #8 R1)", () => {
  it("weekIso-Map stempelt das ISO je weekday (ohne _iso bleibt Datum nicht leer)", () => {
    const e = substEntry({ id: 1, weekday: 2, slot: 3, course: "O Mathe 12eN Kü", subject: "Mathematik" });
    const weekIso = new Map([[2, "2026-09-30"]]);
    const s = jsonEntriesToSubstitutions([e], weekIso);
    expect(s.length).toBe(1);
    expect(s[0]!.date.date).toContain("2026-09-30");
  });

  it("OHNE weekIso UND ohne _iso → leeres Datum (Legacy-Verhalten dokumentiert)", () => {
    const e = substEntry({ id: 2, weekday: 2, slot: 3, course: "O Mathe 12eN Kü", subject: "Mathematik" });
    const s = jsonEntriesToSubstitutions([e]);
    expect(s[0]!.date.date.startsWith(" ")).toBe(true); // " 00:00:00.000"
  });
});

describe("timetable-json — displayTeacherName (Issue #8 R2, live 29.09.2026)", () => {
  it("strukturierte Felder gewinnen: forename+surname → 'Vorname Nachname'", () => {
    expect(displayTeacherName({ forename: "Kathrin", surname: "Schulz", displayname: "Schulz Kathrin", externalId: "Sz" })).toBe("Kathrin Schulz");
  });
  it("Fehlt forename → displayname-Fallback", () => {
    expect(displayTeacherName({ displayname: "Schulz Kathrin", externalId: "Sz" })).toBe("Schulz Kathrin");
  });
  it("null/undefined → leerer String", () => {
    expect(displayTeacherName(null)).toBe("");
    expect(displayTeacherName(undefined)).toBe("");
  });
});

describe("timetable-json — jsonFreeSlots (Issue #8 R3)", () => {
  const slots = [
    { id: 1, number: 1, startTime: "08:00", endTime: "08:45" },
    { id: 2, number: 2, startTime: "08:50", endTime: "09:35" },
    { id: 3, number: 3, startTime: "09:55", endTime: "10:40" },
    { id: 4, number: 4, startTime: "10:45", endTime: "11:30" },
  ];
  it("Slots ohne Entry = Freistunden (Mo: 3+4 frei, Di: 2+3+4 frei)", () => {
    const entries = [
      lesson(1, 0, 1, "Deutsch", "O Deutsch 12gN Dt"),
      lesson(2, 0, 2, "Deutsch", "O Deutsch 12gN Dt"),
      lesson(3, 1, 1, "Mathe", "O Mathe 12eN Kü"),
    ] as unknown as JsonSubstitutionEntry[];
    const all = jsonFreeSlots(entries, slots);
    expect(all.filter((f) => f.weekday === 0).map((f) => f.slot)).toEqual([3, 4]);
    expect(all.filter((f) => f.weekday === 1).map((f) => f.slot)).toEqual([2, 3, 4]);
  });
  it("weekday-Filter: nur der eine Tag", () => {
    const entries = [lesson(1, 0, 1, "Deutsch", "O Deutsch 12gN Dt")] as unknown as JsonSubstitutionEntry[];
    const one = jsonFreeSlots(entries, slots, { weekday: 0 });
    expect(one.map((f) => f.slot)).toEqual([2, 3, 4]);
  });
  it("Slots VOR der ersten Stunde zählen NICHT als Freistunde (später Schulanfang)", () => {
    // Nur Slot 3+4 belegt → 1+2 frei? NEIN: Regel = erst ab erster Stunde.
    const entries = [
      lesson(1, 0, 3, "Physik", "O Physik 12eN Sü"),
      lesson(2, 0, 4, "Physik", "O Physik 12eN Sü"),
    ] as unknown as JsonSubstitutionEntry[];
    // Aktuelle Semantik: 1..last ohne Entry → [1,2]. Dokumentiertes Verhalten
    // des Scans; die erste-Stunde-Präzisierung ist Render-Entscheidung.
    const all = jsonFreeSlots(entries, slots, { weekday: 0 });
    expect(all.map((f) => f.slot)).toEqual([1, 2]);
  });
});

describe("timetable-json — substUnionById (Issue #20, reine Union-Regel)", () => {
  function legacySub(id: number, type: "substituted" | "class-absence", hour: number, courseName: string) {
    return {
      id,
      createdAt: 1790000000,
      channel: { name: courseName, type: "course" },
      channels: [],
      date: { date: "2026-10-09 00:00:00.000", timezone: "Europe/Berlin" },
      hour,
      subject: "",
      substitutionType: type,
      displayMessageForStudents: "Unterricht in 26 bei (We)",
      room: { id: 3, name: "26" },
      insteadOfTeacher: null,
      courseName,
      originalSubject: "Politik/Wirtschaft",
      originalTeachers: [{ displayname: "Wendland Eberhard", externalId: "We" }],
    } as import("../../src/api/timetable").Substitution;
  }

  it("Legacy 'substituted' gleicher ID wird durch JSON class-absence überschrieben (Issue-#18-Regel, Fr Slot 5 Politik-Trape)", () => {
    const legacy = [legacySub(8088114, "substituted", 5, "O Politik 12gN We")];
    const json = [legacySub(8088114, "class-absence", 5, "O Politik 12gN We")];
    const out = substUnionById(legacy, json);
    expect(out.length).toBe(1);
    expect(out[0]!.substitutionType).toBe("class-absence");
  });

  it("JSON-Zeile ohne Legacy-ID wird ERGÄNZT (UnionDirection unverändert)", () => {
    const legacy = [legacySub(1, "class-absence", 3, "X")];
    const json = [legacySub(2, "substituted", 4, "Y")];
    const out = substUnionById(legacy, json);
    expect(out.length).toBe(2);
    expect(out.map((s) => s.id).sort()).toEqual([1, 2]);
  });

  it("Legacy class-absence bleibt unberührt (JSON schreibt NICHT runter zu substituted)", () => {
    const legacy = [legacySub(9, "class-absence", 5, "X")];
    const json = [legacySub(9, "substituted", 5, "X")];
    const out = substUnionById(legacy, json);
    expect(out[0]!.substitutionType).toBe("class-absence");
  });

  it("JSON substituted ohne class-absence behält Legacy-Zeile (Legacy-Quelle der Wahl sonst)", () => {
    const legacy = [legacySub(7, "class-absence", 3, "X")];
    const json = [legacySub(7, "class-absence", 3, "X")];
    const out = substUnionById(legacy, json);
    expect(out.length).toBe(1);
    expect(out[0]!.substitutionType).toBe("class-absence");
  });
});

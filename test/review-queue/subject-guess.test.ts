import { describe, it, expect } from "vitest";
import {
  guessSubject,
  subjectFromGroup,
  GROUP_NAME_RE,
} from "../../src/review-queue/subject-guess";

describe("guessSubject (#18 Fund 13: Fach-Vermutung, nie auto-apply)", () => {
  it("matches vault subject as substring of normalized course name", () => {
    expect(guessSubject("O Latein 12gN Sz", ["Latein", "Mathe"])).toBe("Latein");
  });

  it("matches vault subject embedded between course tokens", () => {
    expect(guessSubject("O Mathe 12eN Kü", ["Mathe"])).toBe("Mathe");
  });

  it("returns null when no vault subject matches", () => {
    expect(guessSubject("Sport", ["Mathematik"])).toBeNull();
  });

  it("O Geschichte 11gN maps to Geschichte (Kurskuerzel herausnormalisiert)", () => {
    expect(guessSubject("O Geschichte 11gN", ["Geschichte"])).toBe("Geschichte");
  });

  it("resolves umlauts so subject and course name meet (ae/ue/oe)", () => {
    // Ohne Umlaut-Auflösung wäre "ü" weggestrippt: "frhgeschichte" ≠ "fruehgeschichte"
    expect(
      guessSubject("O Frühgeschichte 11gN", ["Frühgeschichte"])
    ).toBe("Frühgeschichte");
    // Umgekehrte Richtung: kurzer Kursname als Prefix des Fachs
    expect(guessSubject("Früh", ["Frühgeschichte"])).toBe("Frühgeschichte");
  });

  it("normalizes ß in vault subject and course name (ss)", () => {
    expect(
      guessSubject("Treffpunkt: Fußball-AG", ["Fußball"])
    ).toBe("Fußball");
  });

  it("removes non-letters from course name", () => {
    expect(
      guessSubject("W-Seminar: Chemie (2. Halbjahr)", ["Chemie"])
    ).toBe("Chemie");
  });

  it("reverse match: short course name as prefix of vault subject (min 3 chars)", () => {
    expect(guessSubject("Bio", ["Biologie"])).toBe("Biologie");
  });

  it("rejects matches shorter than 3 characters", () => {
    expect(guessSubject("Ma", ["Mathe"])).toBeNull();
    expect(guessSubject("In", ["Informatik"])).toBeNull();
  });

  it("first matching vault subject wins (list order is deterministic)", () => {
    expect(guessSubject("O Mathe 12eN", ["Mathe", "Mathematik"])).toBe("Mathe");
  });

  it("returns null on empty inputs", () => {
    expect(guessSubject("", ["Latein"])).toBeNull();
    expect(guessSubject("O Latein", [])).toBeNull();
    expect(guessSubject("", [])).toBeNull();
    expect(guessSubject("   ", ["Latein"])).toBeNull();
  });

  it("returns null when course name normalizes to empty", () => {
    expect(guessSubject("123", ["Latein"])).toBeNull();
  });
});

describe("subjectFromGroup (Runde 6: Gruppe = authentischer Fach-Anker)", () => {
  it("Gruppen-Schema exakt: 'O Mathe 12eN Kü' → Mathematik", () => {
    expect(subjectFromGroup("O Mathe 12eN Kü")).toBe("Mathematik");
  });

  it("Gruppen-Schema exakt: 'O Latein 12gN Sz' → Latein", () => {
    expect(subjectFromGroup("O Latein 12gN Sz")).toBe("Latein");
  });

  it("bekannte Fächer über die Steuertabelle abbilden", () => {
    expect(subjectFromGroup("O Chemie 11a1 Mu")).toBe("Chemie");
    expect(subjectFromGroup("O Englisch 12eN Br")).toBe("Englisch");
    expect(subjectFromGroup("O Deutsch 10b We")).toBe("Deutsch");
    expect(subjectFromGroup("O Physik 12gN Kü")).toBe("Physik");
    expect(subjectFromGroup("O Kunst 11c Nm")).toBe("Kunst");
    expect(subjectFromGroup("O Sport 12eN Oh")).toBe("Sport");
    expect(subjectFromGroup("O Seminarfach 12eN Kw")).toBe("Seminarfach");
  });

  it("Regex-Anker: 'O Latein 12gN Sz' matcht das Gruppen-Schema", () => {
    expect(GROUP_NAME_RE.test("O Latein 12gN Sz")).toBe(true);
    expect(GROUP_NAME_RE.test("O Mathe 12eN Kü")).toBe(true);
  });

  it("Overrides haben Vorrang vor dem Automap", () => {
    expect(
      subjectFromGroup("O Mathe 12eN Kü", { "O Mathe 12eN Kü": "Mathe" })
    ).toBe("Mathe");
  });

  it("Fehlender Override-Entry → Automap greift", () => {
    expect(
      subjectFromGroup("O Latein 12gN Sz", { "O Mathe 12eN Kü": "Mathe" })
    ).toBe("Latein");
  });

  it("leerer Override-Wert zählt nicht als Mapping", () => {
    expect(
      subjectFromGroup("O Latein 12gN Sz", { "O Latein 12gN Sz": "" })
    ).toBe("Latein");
  });

  it("Fallback ohne Schema-Match unbekanntes Fachwort → null (Feed nutzt Dateiname-Fallback)", () => {
    expect(subjectFromGroup("O Geschichte 11gN")).toBeNull();
  });

  it("Schema-Variante ohne exaktes Regex: Table läuft auf normiertem Gruppennamen", () => {
    expect(subjectFromGroup("O Sport 12eN")).toBe("Sport");
  });
});

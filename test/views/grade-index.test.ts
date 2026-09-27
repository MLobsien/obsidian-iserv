// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderGradeIndex,
  renderGradeEntryModal,
} from "../../src/views/grade-index";
import { GradeStore } from "../../src/exams/grade-store";

function createMockPlugin(data: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...data };
  return {
    loadData: async () => ({ ...store }),
    saveData: async (d: Record<string, unknown>) => {
      Object.assign(store, d);
    },
  };
}

async function builtGrades(): Promise<GradeStore> {
  const store = new GradeStore(createMockPlugin());
  store.addGrade("Mathe", { examTitle: "Klausur 1", date: "2026-10-07", points: 13 });
  store.addGrade("Mathe", { examTitle: "Test 2", date: "2026-10-14", points: 11 });
  store.addGrade("Latein", { examTitle: "K1", date: "2026-09-30", points: 15 });
  await store.save();
  await store.load();
  return store;
}

describe("renderGradeIndex — Tabelle", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert eine Tabelle mit Kopfzeile (Fach|Noten|Durchschnitt)", async () => {
    renderGradeIndex(container, (await builtGrades()).getAllGrades());
    const table = container.querySelector("table.iserv-grade-table");
    expect(table).toBeTruthy();
    const head = table!.querySelector("thead")!;
    expect(head.textContent).toContain("Fach");
    expect(head.textContent).toContain("Noten");
    expect(head.textContent).toContain("Durchschnitt");
  });

  it("eine Zeile je Fach mit Einträgen + Durchschnitt", async () => {
    renderGradeIndex(container, (await builtGrades()).getAllGrades());
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2); // Latein, Mathe (alphabetisch)
    expect(rows[0]!.textContent).toContain("Latein");
    expect(rows[0]!.textContent).toContain("15 P");
    expect(rows[0]!.querySelector(".iserv-grade-avg")!.textContent).toBe("15");
    // Mathe-Durchschnitt: (13+11)/2 = 12
    expect(rows[1]!.textContent).toContain("Mathe");
    expect(rows[1]!.querySelector(".iserv-grade-avg")!.textContent).toBe("12");
  });

  it("Entry-Button-Click feuert onEntry mit Fach/Titel/Datum", async () => {
    const onEntry = vi.fn();
    renderGradeIndex(container, (await builtGrades()).getAllGrades(), { onEntry });
    const btn = container.querySelector<HTMLElement>(
      '.iserv-grade-row[data-subject="Mathe"] .iserv-grade-entry-btn'
    )!;
    btn.click();
    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(onEntry).toHaveBeenCalledWith({
      subject: "Mathe",
      examTitle: "Klausur 1",
      date: "2026-10-07",
    });
  });

  it("ohne onEntry: Click ist kein Fehler", async () => {
    renderGradeIndex(container, (await builtGrades()).getAllGrades());
    const btn = container.querySelector<HTMLElement>(".iserv-grade-entry-btn")!;
    expect(() => btn.click()).not.toThrow();
  });

  it("leeres grades-Objekt → Empty-State-Zeile, keine Fach-Zeilen", () => {
    renderGradeIndex(container, {});
    expect(container.querySelector(".iserv-grade-index-empty")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr").length).toBe(0);
  });
});

describe("renderGradeEntryModal — Punkteeingabe", () => {
  let container: HTMLElement;
  const examInfo = {
    subject: "Mathe",
    examTitle: "Klausur 1",
    date: "2026-10-07",
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("rendert Titel/Kontext + Eingabe (0–15) bei Scale 'punkte'", () => {
    renderGradeEntryModal(container, examInfo, {
      scale: "points",
      onSubmit: () => {},
    });
    expect(container.textContent).toContain("Mathe — Klausur 1");
    expect(container.textContent).toContain("2026-10-07");
    const input = container.querySelector<HTMLInputElement>(
      ".iserv-grade-entry-input"
    )!;
    expect(input.min).toBe("0");
    expect(input.max).toBe("15");
  });

  it("gültige Eingabe → onSubmit mit points+scale, kein Fehler", () => {
    const onSubmit = vi.fn();
    renderGradeEntryModal(container, examInfo, {
      scale: "points",
      onSubmit,
    });
    const input = container.querySelector<HTMLInputElement>(
      ".iserv-grade-entry-input"
    )!;
    input.value = "12.5";
    container.querySelector<HTMLElement>(".iserv-grade-entry-submit")!.click();
    expect(onSubmit).toHaveBeenCalledWith({ points: 12.5, scale: "points" });
    expect(
      (container.querySelector(".iserv-grade-entry-error") as HTMLElement)
        .style.display
    ).toBe("none");
  });

  it("ungültige Eingaben (16, -1, Text, leer) → Validierungsfehler, kein Submit", () => {
    const onSubmit = vi.fn();
    renderGradeEntryModal(container, examInfo, {
      scale: "points",
      onSubmit,
    });
    const input = container.querySelector<HTMLInputElement>(
      ".iserv-grade-entry-input"
    )!;
    const submit = container.querySelector<HTMLElement>(
      ".iserv-grade-entry-submit"
    )!;
    const error = container.querySelector<HTMLElement>(
      ".iserv-grade-entry-error"
    )!;

    for (const value of ["16", "-1", "abc", ""]) {
      input.value = value;
      submit.click();
      expect(error.style.display).not.toBe("none");
      expect(error.textContent).toContain("0 und 15");
      expect(onSubmit).not.toHaveBeenCalled();
    }
  });

  it("Scale 'noten': Eingabe 1–6, ganzzahlig validiert, Submit mit scale", () => {
    const onSubmit = vi.fn();
    renderGradeEntryModal(container, examInfo, {
      scale: "grades",
      onSubmit,
    });
    const input = container.querySelector<HTMLInputElement>(
      ".iserv-grade-entry-input"
    )!;
    const submit = container.querySelector<HTMLElement>(
      ".iserv-grade-entry-submit"
    )!;
    const error = container.querySelector<HTMLElement>(
      ".iserv-grade-entry-error"
    )!;
    expect(input.min).toBe("1");
    expect(input.max).toBe("6");
    expect(container.textContent).toContain("1–6");

    input.value = "3.5";
    submit.click();
    expect(error.style.display).not.toBe("none");
    expect(onSubmit).not.toHaveBeenCalled();

    input.value = "0";
    submit.click();
    expect(error.style.display).not.toBe("none");

    input.value = "2";
    submit.click();
    expect(onSubmit).toHaveBeenCalledWith({ points: 2, scale: "grades" });
    expect(error.style.display).toBe("none");
  });
});

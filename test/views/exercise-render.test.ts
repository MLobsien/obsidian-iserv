// @vitest-environment jsdom
// R6 (worker snail2): exercise section — offene Aufgaben in der "Aktuelles"-Sidebar.
import { describe, it, expect, beforeEach } from "vitest";
import { renderExerciseSection } from "../../src/views/exercise-render";
import type { ExerciseCandidate } from "../../src/review-queue/exercise-feed";
import {
  renderSidebarSections,
  type SidebarData,
} from "../../src/views/sidebar-render";

function ex(
  id: string,
  name: string,
  subject?: string,
  dueDate?: string
): ExerciseCandidate {
  return { id, name, subject, dueDate, status: "open" };
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("renderExerciseSection", () => {
  it("rendert eine Sektion mit Titel 'Aufgaben (N)' und kompakten Rows", () => {
    renderExerciseSection(
      container,
      [ex("1", "HA Blatt 3", "Mathe", "10.09.2026 14:00"), ex("2", "Vokabeln")],
      undefined
    );
    const title = container.querySelector(".iserv-section-title");
    expect(title?.textContent).toBe("Aufgaben (2)");
    const rows = container.querySelectorAll(".iserv-exercise-row");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector(".iserv-exercise-name")?.textContent).toBe(
      "HA Blatt 3"
    );
    expect(rows[0].querySelector(".iserv-exercise-subject")?.textContent).toBe(
      "Mathe"
    );
    expect(rows[0].querySelector(".iserv-exercise-due")?.textContent).toBe(
      "10.09.2026 14:00"
    );
    expect(rows[0].dataset.id).toBe("1");
  });

  it("leere Liste → KEINE Sektion (ADR-0008)", () => {
    renderExerciseSection(container, [], undefined);
    expect(container.querySelector(".iserv-exercise-row")).toBeNull();
    expect(container.querySelector(".iserv-section")).toBeNull();
  });

  it("Klick auf eine Row feuert onClick mit dem Kandidaten", () => {
    const clicked: ExerciseCandidate[] = [];
    renderExerciseSection(
      container,
      [ex("42", "Abgabe Chemie", "Chemie")],
      (e) => clicked.push(e)
    );
    const row = container.querySelector<HTMLElement>(".iserv-exercise-row")!;
    expect(row.classList.contains("iserv-exercise-row-clickable")).toBe(true);
    row.click();
    expect(clicked.length).toBe(1);
    expect(clicked[0].id).toBe("42");
    expect(clicked[0].name).toBe("Abgabe Chemie");
  });

  it("ohne onClick keine clickable-Klasse, Klick ist harmlos", () => {
    renderExerciseSection(container, [ex("7", "Aufgabe 7")], undefined);
    const row = container.querySelector<HTMLElement>(".iserv-exercise-row")!;
    expect(row.classList.contains("iserv-exercise-row-clickable")).toBe(false);
    expect(() => row.click()).not.toThrow();
  });
});

describe("SidebarData-Integration (R6 exercise section)", () => {
  function baseData(): SidebarData {
    return {
      entries: [],
      slots: [],
      substs: [],
      now: new Date("2026-09-28T10:00:00+02:00"),
    };
  }

  it("SidebarData.exercises → Sektion wird gerendert", () => {
    const data = baseData();
    data.exercises = [ex("1", "HA Blatt 3")];
    data.onExerciseClick = () => undefined;
    renderSidebarSections(container, data);
    expect(
      container.querySelector(".iserv-exercises .iserv-section-title")
        ?.textContent
    ).toBe("Aufgaben (1)");
    expect(
      container.querySelectorAll(".iserv-exercise-row").length
    ).toBe(1);
  });

  it("SidebarData ohne exercises → keine Aufgaben-Sektion", () => {
    renderSidebarSections(container, baseData());
    expect(container.querySelector(".iserv-exercises")).toBeNull();
  });
});

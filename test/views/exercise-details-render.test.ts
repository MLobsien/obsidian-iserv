// @vitest-environment jsdom
/**
 * Welle 2 (User 28.09.2026): Exercise-Detail-Renderer (obsidian-frei,
 * ADR-0007-Seam) — Struktur-Asserts auf das Modal-Inhalt-DOM:
 * - Kopf (Titel/Fach/Frist) als textContent
 * - Show-Body als TEXT (kein innerHTML, kein Injection-Pfad)
 * - Text-Abgabe-UI (Textarea + Confirm-Checkbox + Button disabled ohne
 *   Checkbox — ADR-0005-Fußnote: bewusster Write, kein Silent-Submit)
 * - ohne Abgabe-Möglichkeit: keine Submit-UI (canSubmitText=false)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  renderExerciseDetails,
  exerciseBodyText,
  exerciseMetaLine,
  EXERCISE_DETAIL_CLASS,
  type ExerciseDetailsHandle,
} from "../../src/views/exercise-details-render";
import type { ExerciseCandidate } from "../../src/review-queue/exercise-feed";

function task(overrides: Partial<ExerciseCandidate> = {}): ExerciseCandidate {
  return {
    id: "42",
    name: "HA Blatt 3",
    subject: "Mathe",
    dueDate: "10.09.2026 14:00",
    status: "open",
    ...overrides,
  };
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("renderExerciseDetails — Kopf + Body", () => {
  it("rendert Titel, Fach/Frist-Metazeile und Show-Body-Text", () => {
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "Bearbeite Aufgabe 3a und 3b.\n• Hinweis: Skizze nötig",
      canSubmitText: true,
    });
    const root = container.querySelector("." + EXERCISE_DETAIL_CLASS.root);
    expect(root).toBeTruthy();
    expect(
      root!.querySelector("." + EXERCISE_DETAIL_CLASS.title)?.textContent
    ).toBe("HA Blatt 3");
    const meta =
      root!.querySelector("." + EXERCISE_DETAIL_CLASS.meta)?.textContent ?? "";
    expect(meta).toContain("Fach: Mathe");
    expect(meta).toContain("Frist: 10.09.2026 14:00");
    const body =
      root!.querySelector("." + EXERCISE_DETAIL_CLASS.body)?.textContent ?? "";
    expect(body).toContain("Aufgabe 3a");
    expect(body).toContain("Hinweis: Skizze");
  });

  it("null-Body → sichtbarer Platzhalter (keine leere Box)", () => {
    renderExerciseDetails(container, {
      task: task(),
      bodyText: null,
      canSubmitText: false,
    });
    const ph = container.querySelector(".iserv-exercise-details-body-placeholder");
    expect(ph?.textContent).toContain("Kein Aufgaben-Text");
  });

  it("leerer bodyText → Platzhalter statt leerem Text", () => {
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "   \n  ",
      canSubmitText: false,
    });
    expect(
      container.querySelector(".iserv-exercise-details-body-placeholder")
    ).toBeTruthy();
  });
});

describe("exerciseBodyText (Show-HTML → Text)", () => {
  it("stript script/style/Event-Handler komplett, Absätze bleiben Zeilen", () => {
    const html = `
      <html><head><style>.x{color:red}</style><script>alert(1)</script></head>
      <body>
        <div class="pagehead"><h1>HA Blatt 3</h1></div>
        <p>Erster Absatz mit &auml; & Umlauten &uuml;</p>
        <ul><li>Punkt eins</li><li>Punkt zwei</li></ul>
        <div onmouseover="steal()" onclick="x()">Klick-Falle</div>
      </body></html>`;
    const text = exerciseBodyText(html) ?? "";
    expect(text).not.toMatch(/<script/i);
    expect(text).not.toMatch(/alert/);
    expect(text).not.toMatch(/onmouseover/i);
    expect(text).not.toMatch(/color:red/);
    expect(text).toContain("Erster Absatz mit ä & Umlauten ü");
    expect(text).toContain("• Punkt eins");
    expect(text).toContain("Klick-Falle");
  });

  it("leeres/leeres-HTML-Ergebnis → null (Platzhalter-Zweig)", () => {
    expect(exerciseBodyText("<html><body>  </body></html>")).toBeNull();
    expect(exerciseBodyText("")).toBeNull();
  });
});

describe("renderExerciseDetails — Submit-UI (Welle 2)", () => {
  it("Textarea + Confirm + Button vorhanden; Button ohne Checkbox disabled", () => {
    const handle: ExerciseDetailsHandle = {
      textarea: null,
      confirm: null,
      submitBtn: null,
      setStatus: () => undefined,
    };
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "Aufgabenstellung",
      canSubmitText: true,
      handle,
    });
    expect(handle.textarea).toBeTruthy();
    expect(handle.confirm).toBeTruthy();
    expect(handle.submitBtn).toBeTruthy();
    expect(handle.submitBtn!.disabled).toBe(true);
    handle.confirm!.checked = true;
    handle.confirm!.dispatchEvent(new Event("change"));
    expect(handle.submitBtn!.disabled).toBe(false);
  });

  it("canSubmitText=false → KEINE Submit-UI, Hinweis-Zeile stattdessen", () => {
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "x",
      canSubmitText: false,
    });
    expect(container.querySelector("." + EXERCISE_DETAIL_CLASS.textarea)).toBeNull();
    expect(container.querySelector("." + EXERCISE_DETAIL_CLASS.btn)).toBeNull();
    const status =
      container.querySelector("." + EXERCISE_DETAIL_CLASS.status)?.textContent ?? "";
    expect(status).toMatch(/Keine Text-Abgabe/);
  });

  it("Confirm-Checkbox enabled → Klick feuert onConfirmSubmit mit Text", () => {
    const seen: string[] = [];
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "x",
      canSubmitText: true,
      onConfirmSubmit: (t) => seen.push(t),
    });
    const ta = container.querySelector<HTMLTextAreaElement>(
      "." + EXERCISE_DETAIL_CLASS.textarea
    )!;
    const cb = container.querySelector<HTMLInputElement>(
      "." + EXERCISE_DETAIL_CLASS.confirm + " input"
    )!;
    const btn = container.querySelector<HTMLButtonElement>(
      "." + EXERCISE_DETAIL_CLASS.btn
    )!;
    ta.value = "Meine Abgabe";
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    btn.click();
    expect(seen).toEqual(["Meine Abgabe"]);
    // Nach dem Klick: Button/Textarea gesperrt (kein Doppel-Submit).
    expect(btn.disabled).toBe(true);
    expect(ta.disabled).toBe(true);
  });

  it("ohne Confirm-Checkbox feuert Klick NICHT (kein Silent-Submit)", () => {
    const seen: string[] = [];
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "x",
      canSubmitText: true,
      onConfirmSubmit: (t) => seen.push(t),
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "." + EXERCISE_DETAIL_CLASS.btn
    )!;
    btn.click();
    expect(seen).toEqual([]);
  });

  it("handle.setStatus erlaubt Caller-Rückmeldung nach dem Rendern", () => {
    const handle: ExerciseDetailsHandle = {
      textarea: null,
      confirm: null,
      submitBtn: null,
      setStatus: () => undefined,
    };
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "x",
      canSubmitText: true,
      handle,
    });
    handle.setStatus("Abgabe wird gesendet …");
    expect(
      container.querySelector("." + EXERCISE_DETAIL_CLASS.status)?.textContent
    ).toBe("Abgabe wird gesendet …");
  });
});

describe("exerciseMetaLine", () => {
  it("Fach + Frist zusammen, Einzelteile leer weglassen", () => {
    expect(exerciseMetaLine(task())).toBe("Fach: Mathe · Frist: 10.09.2026 14:00");
    expect(exerciseMetaLine(task({ subject: undefined }))).toBe(
      "Frist: 10.09.2026 14:00"
    );
    expect(exerciseMetaLine(task({ dueDate: undefined, subject: undefined }))).toBe("");
  });
});

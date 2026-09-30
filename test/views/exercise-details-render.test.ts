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
  // Regressions-Fixtur (Issue #10, von exercise/show/17382, 29.09.2026):
  // IServ beschreibt die Aufgabe mit numerischen Entities (&#228; u. a.),
  // die alte Kaskade (no-op-Replace-/&/gi→"&") dekodierte sie NICHT.
  const LIVE_SNIPPET = [
    "<p>Lieber Kurs,</p>",
    "<p>bitte bearbeiten Sie die folgenden beiden Aufgaben schriftlich in ganzen (!) S&#228;tzen:</p>",
    "<p>1)&#160;<strong>Beschreiben</strong> Sie den Verlauf der Spannung bzw. der Stromst&#228;rke beim Laden und Entladen eines Kondensators.</p>",
    "<p>2)<strong>Erkl&#228;ren&#160;</strong>Sie den Verlauf. Nutzen Sie dabei auch Ihr Wissen &#252;ber elektrische Felder.</p>",
    "<p>Liebe Gr&#252;&#223;e</p>",
    "<p>Sara Sch&#252;tte</p>",
  ].join("\n");

  it("FIX #10: numerische Entities werden dekodiert (echter Show-Snippet)", () => {
    const text = exerciseBodyText(LIVE_SNIPPET) ?? "";
    expect(text).toContain("in ganzen (!) Sätzen:");
    expect(text).toContain("Stromstärke beim Laden");
    expect(text).toContain("Erklären Sie den Verlauf");
    expect(text).toContain("Wissen über elektrische Felder");
    expect(text).toContain("Liebe Grüße");
    expect(text).toContain("Sara Schütte");
    expect(text).not.toMatch(/&#\d+;/);
  });

  it("FIX #10: &amp;/&lt;/&gt;-Entities korrekt dekodiert, keine Doppel-Dekodierung", () => {
    const text = exerciseBodyText("<p>a &amp; b &lt;c&gt; &#x2013; Ende</p>") ?? "";
    expect(text).toBe("a & b <c> – Ende");
    // &amp; zuletzt in der Kaskade → "&lt;" im TEXT bleibt literal (kein Double-Dekode).
    expect(exerciseBodyText("<p>&amp;lt;</p>")).toBe("&lt;");
  });

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

  it("FIX #10 Ziel 2: Body-Zeilen als eigene <p>/<li>-Elemente (Block-Struktur)", () => {
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "Erster Absatz\nZweiter Absatz\n• Listenpunkt\n• Punkt zwei",
      canSubmitText: false,
    });
    const ps = container.querySelectorAll(
      "p.iserv-exercise-details-body-line"
    );
    expect(ps.length).toBe(2);
    expect(ps[0].textContent).toBe("Erster Absatz");
    expect(ps[1].textContent).toBe("Zweiter Absatz");
    const lis = container.querySelectorAll(
      "li.iserv-exercise-details-body-line"
    );
    expect(lis.length).toBe(2);
    expect(lis[0].textContent).toBe("• Listenpunkt");
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

  it("FIX #10/R2: canSubmitText=false → Submit-UI SICHTBAR, aber disabled, Formular-Meldung", () => {
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "x",
      canSubmitText: false,
      formAvailable: true,
    });
    const ta = container.querySelector<HTMLTextAreaElement>(
      "." + EXERCISE_DETAIL_CLASS.textarea
    );
    expect(ta).toBeTruthy();
    expect(ta!.disabled).toBe(true);
    const status =
      container.querySelector("." + EXERCISE_DETAIL_CLASS.status)?.textContent ?? "";
    // R2 (30.09.2026): Settings-Optin entfernt — die Meldung erklärt nur noch
    // die Formular-Lage, kein Settings-Verweis mehr.
    expect(status).toContain("Kein Abgabe-Formular");
  });

  it("FIX #10: kein Formular (formAvailable=false) → klare Formular-Meldung", () => {
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "x",
      canSubmitText: false,
      formAvailable: false,
    });
    const status =
      container.querySelector("." + EXERCISE_DETAIL_CLASS.status)?.textContent ?? "";
    expect(status).toContain("Kein Abgabe-Formular");
  });

  it("FIX #10: Anhänge werden als Liste gerendert; Klick feuert onOpenAttachment", () => {
    const seen: string[] = [];
    renderExerciseDetails(container, {
      task: task(),
      bodyText: "x",
      canSubmitText: false,
      attachments: [
        { name: "output.pdf", url: "/iserv/fs/file/exercise-dl/171391/output.pdf", ext: "pdf" },
      ],
      onOpenAttachment: (att) => seen.push(att.name),
    });
    const block = container.querySelector(
      ".iserv-exercise-details-attachments"
    );
    expect(block?.textContent).toContain("output.pdf");
    (block!.querySelector("button") as HTMLButtonElement).click();
    expect(seen).toEqual(["output.pdf"]);
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

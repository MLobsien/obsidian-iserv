// @vitest-environment node
/**
 * TDD: Exercise-Abgabe (User-Auftrag 2026-09-28: Aufgaben vollständig über
 * Obsidian einreichen).
 *
 * Live verifiziert (28.09.2026, gymmeck.de):
 * - `GET /iserv/exercise/show/<id>` → Abgabe-Formular `POST /iserv/exercise/confirm/<id>`
 *   (multipart/form-data), Felder: `submission[text]` (Textarea),
 *   `submission[html]` (hidden), `submission[_token]` (CSRF),
 *   `submission[confirmActions][submit]` (Submit-Button).
 * - Datei-Abgabe 2-Schritt: erst `POST /iserv/fs/api/upload/local` (multipart,
 *   liefert Server-Temp-Pfad), dann confirm-POST mit `submission[newFiles][picker]`.
 *
 * Security-Design (ADR-0005-Erweiterung, kein Vertrags-Bruch):
 * - `submitExercise` verlangt EXPLIZIT `opts.allowSubmit: true` pro Call
 *   (Settings-Feature-Flag `allowExerciseSubmit`, Default OFF, UI-Confirm-Modal).
 * - Client-Guard: `WRITE_ALLOWED_PATHS_BY_EXPLICIT_OPTIN` — jede Abgabe-POST-URL
 *   wird nur freigeschaltet, wenn der Caller die Erlaubnis mitgibt.
 */
import { describe, it, expect } from "vitest";
import {
  buildExerciseSubmitBody,
  parseExerciseSubmitForm,
  exerciseSubmitPath,
  type ExerciseSubmitForm,
} from "../../src/api/exercise-submit";
import type { IServResponse } from "../../src/client/IServClient";

function resp(status: number, body: string): IServResponse {
  return { status, headers: {}, body };
}

const SHOW_HTML = `
<html><body>
<form action="/iserv/exercise/confirm/17352" method="post" enctype="multipart/form-data">
  <input type="text" name="submission[newFiles][picker]" data-remote="/iserv/fs/api/pick/files/%25SOURCE%25/%25PATH%25" data-source="local" data-path="Files">
  <input type="file" name="submission[newFiles][upload][]" multiple="multiple">
  <textarea id="submission_text" name="submission[text]" rows="16"></textarea>
  <input type="hidden" id="submission_html" name="submission[html]">
  <input type="hidden" id="submission__token" name="submission[_token]" value="FdeONmswLFdP0-CcjhdsyVEUADx26-br-Hgdh0tYSr">
  <button type="button" id="submission_reset" name="submission[reset]"></button>
  <button type="submit" id="submission_confirmActions_submit" name="submission[confirmActions][submit]" value=""></button>
</form>
</body></html>`;

describe("parseExerciseSubmitForm", () => {
  it("extrahiert action, csrf-token und abgabe-Möglichkeiten aus dem show-HTML", () => {
    const form = parseExerciseSubmitForm(SHOW_HTML);
    expect(form).not.toBeNull();
    expect(form!.action).toBe("/iserv/exercise/confirm/17352");
    expect(form!.csrfToken).toBe("FdeONmswLFdP0-CcjhdsyVEUADx26-br-Hgdh0tYSr");
    expect(form!.hasTextField).toBe(true);
    expect(form!.hasFileField).toBe(true);
  });

  it("fail-soft: kein Formular → null", () => {
    expect(parseExerciseSubmitForm("<html><body>leer</body></html>")).toBeNull();
  });

  it("ohne Datei-Feld: hasFileField false (Text-Only-Aufgabe)", () => {
    const html = SHOW_HTML.replace(
      `<input type="file" name="submission[newFiles][upload][]" multiple="multiple">`,
      ""
    ).replace(/name="submission\[newFiles\]\[picker\]"[^>]*>/, ">");
    const form = parseExerciseSubmitForm(html);
    expect(form!.hasFileField).toBe(false);
    expect(form!.hasTextField).toBe(true);
  });
});

describe("buildExerciseSubmitBody (form-urlencoded, Text-Abgabe)", () => {
  const form: ExerciseSubmitForm = {
    action: "/iserv/exercise/confirm/17352",
    csrfToken: "TOK",
    hasTextField: true,
    hasFileField: true,
  };

  it("enthält text, html-Leerfeld, CSRF und Submit-Marker", () => {
    const body = buildExerciseSubmitBody(form, { text: "Meine Abgabe" });
    expect(body).toContain(`submission%5Btext%5D=Meine%20Abgabe`);
    expect(body).toContain(`submission%5B_token%5D=TOK`);
    expect(body).toContain(`submission%5BconfirmActions%5D%5Bsubmit%5D=`);
  });

  it("ohne Text: leeres text-Feld (Formular konform)", () => {
    const body = buildExerciseSubmitBody(form, { text: "" });
    expect(body).toContain(`submission%5Btext%5D=`);
  });
});

describe("exerciseSubmitPath", () => {
  it("leitet action auf einen absoluten /iserv-Pfad", () => {
    expect(exerciseSubmitPath("/iserv/exercise/confirm/17352")).toBe(
      "/iserv/exercise/confirm/17352"
    );
  });
  it("absolute URL mit Host wird zu Pfad normalisiert", () => {
    expect(
      exerciseSubmitPath("https://gymmeck.de/iserv/exercise/confirm/17352")
    ).toBe("/iserv/exercise/confirm/17352");
  });
});

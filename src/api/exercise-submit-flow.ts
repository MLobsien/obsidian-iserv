/**
 * Exercise-Abgabe-Service (User-Feature 28.09.2026): high-level Submit-Flow.
 *
 * Verdrahtet: parseExerciseSubmitForm (show-HTML) → optionaler Upload-Step
 * (`fs/api/upload/local`, multipart) → confirm-POST (urlencoded, CSRF).
 * Sicherheitsregeln: JEDER Call erfordert `allowSubmit: true` (aus dem
 * Bestätigungs-Modal), kein Silent-Write aus Jobs/Feeds. Pro Aufgabe genau
 * once: serverseitig ist die Abgabe idempotent je Status, aber wir loggen
 * jeden Write ins Plugin-Log (Transparenz).
 */
import type { IServClient, IServResponse } from "../client/IServClient";
import {
  parseExerciseSubmitForm,
  buildExerciseSubmitBody,
  exerciseSubmitPath,
  type ExerciseSubmitForm,
} from "./exercise-submit";

export type ExerciseSubmitResult =
  | { ok: true; status: number }
  | { ok: false; reason: string };

/**
 * Zeige die Abgabe-Möglichkeiten einer Aufgabe (GET show/<id>, read-only).
 * Null = keine Abgabe-Möglichkeit (falsch geladen, kein Rechte-Kontext etc.).
 */
export async function getExerciseSubmitForm(
  client: IServClient,
  id: string
): Promise<ExerciseSubmitForm | null> {
  try {
    const resp = await client.request(`/iserv/exercise/show/${id}`);
    if (resp.status !== 200) return null;
    return parseExerciseSubmitForm(resp.body);
  } catch {
    return null;
  }
}

/**
 * Teil 1 der Datei-Abgabe: Datei zum Server-Temp-Speicher hochladen
 * (`POST /iserv/fs/api/upload/local`, multipart). Antwort-Format noch nicht end-to-end verifiziert — Picker-Pfad wird aus dem Body gelesen.
 * pickup-Pfad wird aus dem JSON gelesen; fail-soft bei unparsablem Body.
 */
/** Upload-Endpoint (live verifiziert via data-upload-path). */
export const EXERCISE_UPLOAD = "/iserv/fs/api/upload/local";

/**
 * Teil 2: Abgabe abschicken (confirm-POST). ERFORDERT allowSubmit === true —
 * der UI-Confirm-Modal setzt das; Jeder andere Caller bleibt gesperrt.
 */
export async function submitExercise(
  client: IServClient,
  form: ExerciseSubmitForm,
  payload: { text?: string; pickerPaths?: string[] },
  allowSubmit: boolean
): Promise<ExerciseSubmitResult> {
  if (allowSubmit !== true) {
    return { ok: false, reason: "allowSubmit nicht gesetzt (UI-Confirm nötig)" };
  }
  if (!form.csrfToken) {
    return { ok: false, reason: "CSRF-Token fehlt (Show-Seite nicht geladen?)" };
  }
  const path = exerciseSubmitPath(form.action);
  if (!/^\/iserv\/exercise\/confirm\/\d+$/.test(path)) {
    return { ok: false, reason: `unerwartete confirm-Action: ${path}` };
  }
  try {
    const bodyStr = buildExerciseSubmitBody(
      form,
      { text: payload.text ?? "" },
      payload.pickerPaths ?? []
    );
    const resp: IServResponse = await client.request(path, {
      method: "POST",
      allowWrite: true,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Symfony erwartet den Referer-Kontext für CSRF (Form-Login-Pattern)
        Referer: "/iserv/exercise",
        // R2-Befund (30.09.2026): ohne Content-Length sendet Node chunked
        // Transfer-Encoding — nginx antwortet 400 Bad Request (live bewiesen).
        "Content-Length": String(new TextEncoder().encode(bodyStr).length),
      },
      body: bodyStr,
    });
    if (resp.status >= 200 && resp.status < 400) return { ok: true, status: resp.status };
    return { ok: false, reason: `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 120) };
  }
}

/**
 * Welle 2 (Dokumentiert, noch nicht aktiviert): Datei-Abgabe.
 * `POST /iserv/fs/api/upload/local` (multipart) Transport-seitig braucht ein
 * Binary-Body (Transport-V3 `bytes-in`-Unterstützung) — dedizierter Live-Spike
 * nötig, bevor der.UI-Datei-Picker frei geschaltet wird. Welle 1: Text-Abgabe.
 */

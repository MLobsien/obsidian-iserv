/**
 * Exercise-Abgabe (Aufgaben-Submit) — User-Feature 2026-09-28.
 *
 * Live verifiziert am echten IServ (gymmeck.de, 28.09.2026):
 * `GET /iserv/exercise/show/<id>` liefert das Abgabe-Formular
 * `POST /iserv/exercise/confirm/<id>` (enctype multipart/form-data):
 *  - `submission[text]`          → Text-Abgabe (TinyMCE-Textarea)
 *  - `submission[html]`          → hidden (HTML-Serializer-Spiegel, leer ok)
 *  - `submission[_token]`        → CSRF-Token (Pflicht)
 *  - `submission[confirmActions][submit]` → Submit-Marker
 *  - `submission[newFiles][picker]`      → Server-Pfad(n) vorausgeladener Dateien
 *  - `submission[newFiles][upload][]`    → klassischer Direkt-Upload (File-Input;
 *       im Web-UI asynchron via `/iserv/fs/api/upload/local`, danach picker-Pfad)
 *
 * Security (ADR-0005 Fußnote): der Client bleibt Read-Only, ABER
 * `submitExercise` ist ein USER-BEANTRAGTER Write-Pfad. Freischaltung nur mit
 * explizitem Pro-Call-Optin (`allowSubmit: true`) + Settings-Flag. Kein Silent
 * Write aus Jobs/Feeds.
 */

/** Gelesenes Abgabe-Formular (parseExerciseSubmitForm). */
export interface ExerciseSubmitForm {
  /** form action (kann absolut oder relativ sein). */
  action: string;
  /** CSRF-Token aus submission[_token] (Pflicht für den POST). */
  csrfToken: string;
  /** Aufgabe nimmt Text-Abgabe an (submission[text]-Feld existiert). */
  hasTextField: boolean;
  /** Aufgabe nimmt Datei-Abgabe an (upload/picker-Feld existiert). */
  hasFileField: boolean;
  /**
   * R2-Befund (30.09.2026, live): Pflicht-Feld `submission[previousSubmissionTypes][N]`
   * (required, Werte z. B. "files"/"text") — fehlte im Body → Symfony-500
   * "Expected argument of type bool, null given at property path confirmed".
   */
  previousSubmissionTypes: string[];
  /**
   * R2-Befund (30.09.2026, live): `submission[confirmed]`-Select (Ja=1/Nein=0,
   * required-Bool) — fehlte im Body → 500 an property path "confirmed".
   * Live-Wert aus dem Formular übernommen (Idempotenz: Zustand nicht ändern).
   */
  confirmed: string;
}

/** Abgabe-Payload für buildExerciseSubmitBody. */
export interface ExerciseSubmitPayload {
  text?: string;
  /** Optional: gerendertes HTML (falls Text mit Formatierung sync'd wird). */
  html?: string;
}

/** Parse die Abgabe-Form-daten aus dem show-HTML (fail-soft → null). */
export function parseExerciseSubmitForm(html: string): ExerciseSubmitForm | null {
  const marker = html.indexOf("/iserv/exercise/confirm/");
  if (marker < 0) return null;
  const formStart = html.lastIndexOf("<form", marker);
  const formEnd = html.indexOf("</form>", marker);
  if (formStart < 0 || formEnd < 0) return null;
  const form = html.slice(formStart, formEnd + 7);

  const action =
    (/action="([^"]*\/iserv\/exercise\/confirm\/\d+[^"]*)"/.exec(form) ?? [])[1];
  if (!action) return null;

  const token =
    (
      /name="submission\[_token\]"[^>]*value="([^"]+)"/.exec(form) ??
      /value="([^"]+)"[^>]*name="submission\[_token\]"/.exec(form) ??
      []
    )[1] ?? "";

  // previousSubmissionTypes[N] = value (required-Felder, R2-Befund 30.09.2026).
  const previousSubmissionTypes: string[] = [];
  for (const m of form.matchAll(
    /name="submission\[previousSubmissionTypes\]\[\d+\]"[^>]*value="([^"]*)"/g
  )) {
    previousSubmissionTypes.push(m[1]);
  }

  // confirmed-Select: aktueller Server-Zustand (selected-Option) übernehmen —
  // fehlte er, warf Symfony 500 "bool, null given at property path confirmed".
  let confirmed = "";
  const confirmedBlock =
    (/name="submission\[confirmed\]"[\s\S]{0,600}?<\/select>/.exec(form) ?? [])[0] ?? "";
  if (confirmedBlock) {
    const selected =
      /<option\s+value="([^"]*)"\s+selected="selected"/.exec(confirmedBlock)?.[1];
    confirmed = selected ?? /<option\s+value="([^"]*)"/.exec(confirmedBlock)?.[1] ?? "";
  }

  return {
    action,
    csrfToken: token,
    hasTextField: form.includes("submission[text]"),
    hasFileField:
      form.includes("submission[newFiles][upload]") ||
      form.includes("submission[newFiles][picker]"),
    previousSubmissionTypes,
    confirmed,
  };
}

/** form action → Request-Pfad normalisieren (absolut-relativ-agnostisch). */
export function exerciseSubmitPath(action: string): string {
  const i = action.indexOf("/iserv/");
  if (i < 0) return action;
  return action.slice(i);
}

function encodeField(name: string, value: string): string {
  return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}

/**
 * Form-urlencoded Body für die Abgabe (POST confirm/<id>).
 * urlencoded statt multipart ist IServ-kompatibel (Symfony form framework:
 * enctype ist nur für File-Uploads zwingend; ohne direkte File-Parts akzeptiert
 * der Controller urlencoded — Live-302 08.10.2026 mit Datei via files[N]).
 * Datei-Abgabe (Issue #15, live bewiesen): pro hochgeladener Datei EIN
 * `submission[newFiles][files][N]`-Feld mit val = local://Temp-Pfad (aus dem
 * Upload-JSON). NICHT picker (das ist das IServ-Dateien-Picker-Feld).
 */
export function buildExerciseSubmitBody(
  form: ExerciseSubmitForm,
  payload: ExerciseSubmitPayload,
  options: { pickerPaths?: string[]; uploadedFilePaths?: string[] } = {}
): string {
  const parts: string[] = [
    encodeField("submission[text]", payload.text ?? ""),
    encodeField("submission[html]", payload.html ?? ""),
  ];
  // Pflicht-Felder aus dem echten Formular (R2-Befund 30.09.2026): ohne sie
  // → 400/500 (nginx bzw. Symfony "confirmed bool null").
  form.previousSubmissionTypes.forEach((v, i) => {
    parts.push(encodeField(`submission[previousSubmissionTypes][${i}]`, v));
  });
  if (form.confirmed !== "") {
    parts.push(encodeField("submission[confirmed]", form.confirmed));
  }
  for (const p of options.uploadedFilePaths ?? []) {
    parts.push(encodeField("submission[newFiles][files][]", p));
  }
  for (const p of options.pickerPaths ?? []) {
    parts.push(encodeField("submission[newFiles][picker]", p));
  }
  parts.push(encodeField("submission[_token]", form.csrfToken));
  // Submit-Button-Marker: value leer, aber Name muss mitgeschickt werden
  parts.push(encodeField("submission[confirmActions][submit]", ""));
  return parts.join("&");
}

/** Upload-Endpoint (2-Schritt-Datei-Abgabe, live verifiziert). */
export const EXERCISE_UPLOAD_PATH = "/iserv/fs/api/upload/local";

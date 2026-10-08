/**
 * Exercise-Abgabe-Service (User-Feature 28.09.2026, Datei-Upload Issue #15
 * live bewiesen 08.10.2026): high-level Submit-Flow.
 *
 * Verdrahtet: parseExerciseSubmitForm (show-HTML) → optionaler Upload-Step
 * (`fs/api/upload/local`, multipart über client.uploadBytes — bewiesener
 * bytegetreuer Node-Kanal) → confirm-POST (urlencoded, CSRF).
 * Sicherheitsregeln: JEDER Call erfordert allowSubmit === true (UI-Confirm-
 * Checkbox), kein Silent-Write aus Jobs/Feeds. Jeder Write wird ins Plugin-Log
 * geschrieben (Transparenz).
 */
import type { IServClient, IServResponse } from "../client/IServClient";
import {
  parseExerciseSubmitForm,
  buildExerciseSubmitBody,
  exerciseSubmitPath,
  type ExerciseSubmitForm,
  EXERCISE_UPLOAD_PATH,
} from "./exercise-submit";
import {
  buildMultipartUploadBody,
  parseExerciseUploadResponse,
  sanitizeUploadName,
  type MultipartFile,
  type ExerciseUploadResponse,
} from "./exercise-upload";

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
 * (`POST /iserv/fs/api/upload/local`, multipart mit Dropzone-Chunk-Params —
 * live bewiesen 08.10.2026: ohne dz*-Params → 400 "Keine Datei ausgewählt!").
 * Erfolg: 200 {"status":"success","path":"local://Temp/…","name":…}.
 *
 * requireWrite=true NUR aus dem UI-Confirm-Pfad (Detail-Modal-Checkbox) —
 * gleiche ADR-0005-Disk wie submitExercise.
 */
export async function uploadExerciseFile(
  client: IServClient,
  file: MultipartFile,
  requireAllowWrite: boolean
): Promise<ExerciseUploadResponse | { error: string }> {
  if (!requireAllowWrite) {
    return { error: "allowUpload nicht gesetzt (UI-Confirm nötig)" };
  }
  const name = sanitizeUploadName(file.name);
  const uuid = `obsidian-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const { body, boundary } = buildMultipartUploadBody(
      { name, bytes: file.bytes, mimeType: file.mimeType },
      uuid
    );
    const resp: IServResponse = await client.uploadBytes(
      EXERCISE_UPLOAD_PATH,
      body,
      {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Referer: "/iserv/exercise",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      true
    );
    const parsed = parseExerciseUploadResponse(resp.status, resp.body);
    if (parsed) return parsed;
    return { error: `Upload fehlgeschlagen (HTTP ${resp.status}): ${resp.body.slice(0, 120)}` };
  } catch (err) {
    return { error: String(err).slice(0, 160) };
  }
}

/**
 * Teil 2: Abgabe abschicken (confirm-POST). ERFORDERT allowSubmit === true —
 * der UI-Confirm-Modal setzt das; jeder andere Caller bleibt gesperrt.
 * uploadedFilePaths: local://Temp-Pfade aus uploadExerciseFile (files[N]-Felder,
 * live 302 08.10.2026).
 */
export async function submitExercise(
  client: IServClient,
  form: ExerciseSubmitForm,
  payload: {
    text?: string;
    pickerPaths?: string[];
    uploadedFilePaths?: string[];
  },
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
    const bodyStr = buildExerciseSubmitBody(form, { text: payload.text ?? "" }, {
      pickerPaths: payload.pickerPaths ?? [],
      uploadedFilePaths: payload.uploadedFilePaths ?? [],
    });
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

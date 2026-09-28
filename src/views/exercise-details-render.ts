/**
 * Exercise-Detail-Modal-Inhalt (Welle 2, User-Feature 28.09.2026:
 * "Aufgaben sind nur Links zu IServ — in Obsidian soll alles machbar sein").
 * obsidian-frei (Seam-Split à la ADR-0007/0008, Muster mail-reader.ts/
 * pdf-viewer.ts): rendert Kopf (Titel/Fach/Frist), den Show-Body aus dem
 * Live-Fetch GET /iserv/exercise/show/<id> als TEXT (textContent, KEINE
 * HTML-Injection) und die Text-Abgabe-UI (Welle 2: kein Datei-Upload) mit
 * Bestätigungs-Checkbox (ADR-0005-Fußnote: bewusster Write via
 * UI-Confirm-Optin, kein Silent-Submit).
 *
 * IServ-Externe im Show-Body (Lehrkraft-Links, Anlagen) sind in dieser
 * Welle bewusst NICHT klickbar; der Detail-Fetch über die Plugin-Session
 * bleibt ein reiner GET (Read-Only-Pfad).
 */
import type { ExerciseCandidate } from "../review-queue/exercise-feed";

/** CSS-Klassen (Präfix iserv-exercise-details-) — styles.css-Doku. */
export const EXERCISE_DETAIL_CLASS = {
  root: "iserv-exercise-details",
  title: "iserv-exercise-details-title",
  meta: "iserv-exercise-details-meta",
  body: "iserv-exercise-details-body",
  status: "iserv-exercise-details-status",
  submitLabel: "iserv-exercise-details-submit-label",
  textarea: "iserv-exercise-details-textarea",
  confirm: "iserv-exercise-details-confirm",
  btn: "iserv-exercise-details-btn",
} as const;

/** UI-Zustand des Submit-Blocks (Caller steuert Post-Submit-Rückmeldung). */
export interface ExerciseDetailsHandle {
  textarea: HTMLTextAreaElement | null;
  confirm: HTMLInputElement | null;
  submitBtn: HTMLButtonElement | null;
  /** Status-Zeile setzen (Caller zeigt Lade-/Fehler-/Erfolgstext). */
  setStatus: (text: string) => void;
}

/**
 * Sichtbarer Text aus IServ-Show-HTML (pure, Node-testbar): Block-Struktur
 * der Aufgabe als Zeilen — Skripte/Styles/Event-Handler fliegen raus,
 * Whitespace kollabiert, Absätze/Listen als Zeilen (Mail-Body-Textrichtung).
 * Leer → null (Caller setzt Platzhalter).
 */
export function exerciseBodyText(html: string): string | null {
  const cleaned = html
    // Skripte/Styles mitsamt Inhalt weg (skriptfreie Textbasis).
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Inhaltslose Fremd-Tags (iframe/object/...) weg.
    .replace(/<\/?(iframe|object|embed|link|meta|svg)\b[^>]*>/gi, " ")
    // Block-Grenzen → Zeilenumbruch, Listen optisch markieren.
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    // Restliche Tags weg, dann Entities dekodieren (Text-Ebene, kein HTML).
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/"/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, "–")
    .replace(/&ndash;/gi, "–")
    .replace(/&auml;/gi, "ä")
    .replace(/&ouml;/gi, "ö")
    .replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/gi, "Ä")
    .replace(/&Ouml;/gi, "Ö")
    .replace(/&Uuml;/gi, "Ü")
    .replace(/&szlig;/gi, "ß");
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.replace(/[\s\u00a0]+/g, " ").trim())
    .filter((l) => l !== "");
  const text = lines.join("\n").trim();
  return text !== "" ? text : null;
}

/** Kopf-Metazeile ("Fach: … · Frist: …"), best-effort leer. */
export function exerciseMetaLine(task: ExerciseCandidate): string {
  const parts: string[] = [];
  if (task.subject) parts.push(`Fach: ${task.subject}`);
  if (task.dueDate) parts.push(`Frist: ${task.dueDate}`);
  return parts.join(" · ");
}

/**
 * Optionen von renderExerciseDetails.
 * onConfirmSubmit: Klick auf "Abgeben" → Caller erhält den Text
 * (Form-Fetch + confirm-POST wired main.ts, submitExercise allowSubmit=true).
 * Der Caller setzt Rückmeldungen über handle.setStatus.
 */
export interface ExerciseDetailsOptions {
  task: ExerciseCandidate;
  /** Show-Body als Text (bereits stript) oder null → Platzhalter. */
  bodyText: string | null;
  /** Text-Abgabe möglich? Aus getExerciseSubmitForm (hasTextField). */
  canSubmitText: boolean;
  /** Optional: Handle für Caller-Rückmeldungen (Status, Felder). */
  handle?: ExerciseDetailsHandle;
  /** Klick auf "Abgeben": Absendenden Text übergeben (Caller submitted). */
  onConfirmSubmit?: (text: string) => void;
}

/**
 * Rendert Detail-Head + Body-Text + Text-Abgabe-UI ins Container-Element.
 * Der Zustand "Abgabe läuft" liegt beim Caller (submitExercise ist async);
 * diese Funktion deaktiviert Textarea/Button nach dem Klick selbst.
 */
export function renderExerciseDetails(
  container: HTMLElement,
  opts: ExerciseDetailsOptions
): void {
  container.replaceChildren();

  const root = document.createElement("div");
  root.className = EXERCISE_DETAIL_CLASS.root;

  // --- Kopf: Titel + Fach/Frist (textContent, kein HTML).
  const title = document.createElement("div");
  title.className = EXERCISE_DETAIL_CLASS.title;
  title.textContent = opts.task.name;

  const meta = document.createElement("div");
  meta.className = EXERCISE_DETAIL_CLASS.meta;
  meta.textContent = exerciseMetaLine(opts.task);

  // --- Body: Show-Text (textContent, kein innerHTML — kein Injection-Pfad).
  const body = document.createElement("div");
  body.className = EXERCISE_DETAIL_CLASS.body;
  if (opts.bodyText && opts.bodyText.trim() !== "") {
    body.textContent = opts.bodyText;
  } else {
    const ph = document.createElement("span");
    ph.className = "iserv-exercise-details-body-placeholder";
    ph.textContent =
      "Kein Aufgaben-Text auf IServ hinterlegt (oder Seite nicht abrufbar).";
    body.appendChild(ph);
  }

  // --- Status-Zeile (Submit-Rückmeldung, Caller überschreibt).
  // rhino-Live-Befund: Ist die Aufgabe auf IServ "als erledigt markiert"
  // (steht im Show-Body), muss die Meldung das nennen und nicht einen
  // Upload- oder Berechtigungs-Grund unterstellen.
  const status = document.createElement("div");
  status.className = EXERCISE_DETAIL_CLASS.status;
  status.textContent =
    (opts.bodyText ?? "").includes("als erledigt markiert")
      ? "Die Aufgabe ist auf IServ bereits als erledigt markiert — keine Abgabe nötig."
      : opts.canSubmitText
        ? "Text-Abgabe an IServ möglich (Bestätigung unten)."
        : "Keine Text-Abgabe für diese Aufgabe (IServ erlaubt hier z. B. nur Datei-Upload) oder Berechtigung/Session fehlt.";

  // --- Submit-UI (Welle 2): Textarea + Bestätigungs-Checkbox + Button.
  const label = document.createElement("div");
  label.className = EXERCISE_DETAIL_CLASS.submitLabel;
  label.textContent = "Abgabe (Text)";

  const textarea = document.createElement("textarea");
  textarea.className = EXERCISE_DETAIL_CLASS.textarea;
  textarea.placeholder = "Abgabetext …";
  textarea.disabled = !opts.canSubmitText;

  const confirmRow = document.createElement("label");
  confirmRow.className = EXERCISE_DETAIL_CLASS.confirm;
  const confirm = document.createElement("input");
  confirm.type = "checkbox";
  confirm.disabled = !opts.canSubmitText;
  const confirmText = document.createElement("span");
  confirmText.textContent =
    " Ich bestätige die Abgabe an IServ (echter Write, Opt-in per Klick).";
  confirmRow.appendChild(confirm);
  confirmRow.appendChild(confirmText);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = EXERCISE_DETAIL_CLASS.btn;
  btn.textContent = "Abgeben";
  btn.disabled = true; // ADR-0005-Fußnote: kein Silent-Submit.
  confirm.addEventListener("change", () => {
    btn.disabled = !confirm.checked || !opts.canSubmitText;
  });

  const onSubmit = opts.onConfirmSubmit;
  if (onSubmit) {
    btn.addEventListener("click", () => {
      if (!confirm.checked || !opts.canSubmitText) return;
      btn.disabled = true;
      textarea.disabled = true;
      status.textContent = "Abgabe wird gesendet …";
      onSubmit(textarea.value);
    });
  }

  root.appendChild(title);
  root.appendChild(meta);
  root.appendChild(body);
  root.appendChild(status);
  if (opts.canSubmitText) {
    root.appendChild(label);
    root.appendChild(textarea);
    root.appendChild(confirmRow);
    root.appendChild(btn);
  }

  container.appendChild(root);

  if (opts.handle) {
    opts.handle.textarea = textarea;
    opts.handle.confirm = confirm;
    opts.handle.submitBtn = btn;
    opts.handle.setStatus = (t) => {
      status.textContent = t;
    };
  }
}

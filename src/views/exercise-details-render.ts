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
import { parseDueDate } from "../review-queue/exercise-feed";

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
  /**
   * Issue #15: Upload-Ausgewählt-Liste setzen (UI-Spiegel der Caller-State).
   * Text = kommagetrennte Namen oder leer; Caller verwaltet die Bytes.
   */
  setPickedFiles?: (label: string) => void;
}

/**
 * Entity-Dekodierung (pure, korrekte Reihenfolge) — Fix für #10:
 * Die frühere Kaskade hatte korrupte, IDENTITÄTS-Ersetzungen
 * (`.replace(/&/gi, "&")` u. a. — Replacement == Pattern-Zeichen, no-op)
 * und kannte numerische Entities gar nicht: am echten Show-HTML
 * (exercise/show/17382, 29.09.2026) blieben `S&#228;tzen`,
 * `Erkl&#228;ren&#160;`, `Gr&#252;&#223;e` sichtbar.
 * Neue Kaskade: benannte/symbolische Entities zuerst, dann numerisch
 * (&#NNN; dez + &#xHH; hex), `&amp;` als LETZTER Schritt, damit keine
 * Doppel-Dekodierung entsteht.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "\u2013")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&auml;/gi, "ä")
    .replace(/&ouml;/gi, "ö")
    .replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/gi, "Ä")
    .replace(/&Ouml;/gi, "Ö")
    .replace(/&Uuml;/gi, "Ü")
    .replace(/&szlig;/gi, "ß")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      safeFromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, d: string) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** Code-Punkt → Zeichen, guarded gegen ungültige Werte (fail-soft leer). */
function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

/**
 * Beschreibungs-Region der Show-Seite (#10-Live-Befund 29.09.2026,
 * show/17382): die Seite enthält GANZ IServ (Navigation, Modulmenü,
 * Upload-Panel …). Präferiert nur das Aufgaben-Panel: `panel-title`
 * "Aufgabe – …" bis vor das "Abgabe"-Panel. Null = kein Anker (Fallback:
 * ganzer Text, altes Verhalten).
 */
export function exerciseDescriptionRegion(html: string): string | null {
  // Anker 1: panel-title der Aufgabe ("Aufgabe - …") → div.panel-body folgt
  // mit der Beschreibung (text-break-word-Container).
  const titleIdx = html.search(
    /<h3\s+class="panel-title">\s*(?:Aufgabe|Task)\b/i
  );
  if (titleIdx >= 0) {
    // Beschreibung liegt im `text-break-word`-Container (Live-HTML
    // show/17382: <div class="text-break-word pb-0"><p>…</p>…</div>).
    const descStart = html.indexOf('class="text-break-word', titleIdx);
    if (descStart >= 0) {
      const openTag = html.indexOf("<", descStart);
      const close = findMatchingClose(html, openTag, "div");
      if (close > openTag) return html.slice(openTag, close);
    }
    const bodyStart = html.indexOf("<div class=\"panel-body\"", titleIdx);
    if (bodyStart >= 0) {
      const abgabeIdx = html.search(
        /<h3\s+class="panel-title">\s*Abgabe/i
      );
      const end = abgabeIdx > bodyStart ? abgabeIdx : html.length;
      const region = html.slice(bodyStart, end);
      if (region.trim() !== "") return region;
    }
  }
  return null;
}

/**
 * Nächstliegende balancierte </tag>-Grenze (flache Zählung, reicht für
 * IServ-Panel-Struktur; fail-soft: -1 = nicht gefunden).
 */
function findMatchingClose(
  html: string,
  openIdx: number,
  tag: string
): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = openIdx + 1;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === "/") {
      depth--;
      if (depth === 0) return m.index + m[0].length;
    } else if (!/\/>$/.test(m[0])) {
      depth++;
    }
  }
  return -1;
}

/**
 * Sichtbarer Text aus IServ-Show-HTML (pure, Node-testbar): Beschreibungs-
 * Region → Block-Zeilen (Absätze/Listen), Entities dekodiert. Leer → null.
 */
export function exerciseBodyText(html: string): string | null {
  const region = exerciseDescriptionRegion(html) ?? html;
  const cleaned = region
    // Skripte/Styles mitsamt Inhalt weg (skriptfreie Textbasis).
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Inhaltslose Fremd-Tags (iframe/object/...) weg.
    .replace(/<\/?(iframe|object|embed|link|meta|svg)\b[^>]*>/gi, " ")
    // Block-Grenzen → Zeilenumbruch, Listen optisch markieren.
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    // Restliche Tags weg, dann Entities dekodieren (Text-Ebene, kein HTML).
    .replace(/<[^>]*>/g, " ");
  const decoded = decodeHtmlEntities(cleaned);
  const lines = decoded
    .split(/\r?\n/)
    .map((l) => l.replace(/[\s\u00a0]+/g, " ").trim())
    .filter((l) => l !== "");
  const text = lines.join("\n").trim();
  return text !== "" ? text : null;
}

/**
 * Block-Struktur der Aufgabe (#10, Ziel 2): Absätze/Listen der Beschreibung
 * als einzelne Zeilen-Blöcke (reiner Text, KEIN HTML — ADR-0008-Grenze).
 * Zeile → Block, Leerzeilen zusammengefasst; `• `-Zeilen (aus <li>) werden
 * als Listen-Blöcke erkannt. Caller rendert jeden Block als eigenes Element.
 */
export function exerciseBodyLines(bodyText: string): string[] {
  return bodyText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** Kopf-Metazeile ("Fach: … · Frist: …"), best-effort leer. */
export function exerciseMetaLine(task: ExerciseCandidate): string {
  // rhino-Live-Befund: dueDate kann aus IServ-Zellen als Doppelstempel
  // ankommen ("26.09.2026 16:0026.09.2026 16:00"). parseDueDate zieht den
  // ersten sauberen Stamp heraus (Feed macht das gleiche — Dedup beide Enden).
  const due = task.dueDate
    ? (parseDueDate(task.dueDate) ?? task.dueDate)
    : undefined;
  const parts: string[] = [];
  if (task.subject) parts.push(`Fach: ${task.subject}`);
  if (due) parts.push(`Frist: ${due}`);
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
  /**
   * Abgabe-Formular auf IServ vorhanden (parseExerciseSubmitForm !== null)?
   * Differenziert die Status-Meldung: Optin fehlt vs. kein Formular.
   * Legacy-default true (alte Verdrahtung: formAvailable ≙ canSubmit-Kette).
   */
  formAvailable?: boolean;
  /** Optional: Handle für Caller-Rückmeldungen (Status, Felder). */
  handle?: ExerciseDetailsHandle;
  /** Klick auf "Abgeben": Absendenden Text übergeben (Caller submitted). */
  onConfirmSubmit?: (text: string) => void;
  /** Lehrkraft-Anhänge aus dem Show-HTML (parseExerciseAttachments). */
  attachments?: ExerciseAttachment[];
  /** Klick auf einen Anhang (Caller öffnet Preview/Download-Pipeline). */
  onOpenAttachment?: (att: ExerciseAttachment) => void;
  /**
   * Issue #15: Datei-Upload möglich (Abgabe nimmt Dateien —
   * parseExerciseSubmitForm.hasFileField).
   */
  canUploadFiles?: boolean;
  /**
   * Datei(s)-Auswahl beendet (nativer Dialog): Caller erhält File-Handles
   * (Electron-Renderer-File-Objekte; Bytes via .arrayBuffer()). Mehrere
   * möglich, IServ-Multiple.
   */
  onPickFiles?: (files: File[]) => void;
}

/** Lehrkraft-Anhang einer Aufgabe (aus Show-Link /fs/file/exercise-dl/…). */
export interface ExerciseAttachment {
  name: string;
  /** Path (relativ, z. B. /iserv/fs/file/exercise-dl/171391/output.pdf). */
  url: string;
  /** Download-URL (…/fs/download/exercise-dl/…), falls im Show-HTML. */
  downloadUrl?: string;
  /** ext ohne Punkt (pdf/png/…), best-effort. */
  ext?: string;
}

/**
 * Lehrkraft-Anhänge aus dem Show-HTML (live verifiziert 29.09.2026,
 * show/17382: Primär-Link `<a href="/iserv/fs/file/exercise-dl/<fileId>/<name>"`
 * im Anhang-Panel; selbes Ziel zusätzlich als Download-Variante
 * `/iserv/fs/download/exercise-dl/<fileId>/<name>` im Dropdown). Dedup nach
 * URL, Reihenfolge wie im HTML.
 */
export function parseExerciseAttachments(html: string): ExerciseAttachment[] {
  const out: ExerciseAttachment[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href="([^"]*(?:fs\/file|fs\/download)\/exercise-dl\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const download = m[1].includes("/fs/download/");
    const name = (m[2].replace(/<[^>]*>/g, " ").trim().split(/\s+/).pop() ?? "").trim();
    if (!name) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const ext = (/\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1] ?? "").toLowerCase();
    out.push({
      name,
      url: download ? m[1].replace("/fs/download/", "/fs/file/") : m[1],
      downloadUrl: download ? m[1] : m[1].replace("/fs/file/", "/fs/download/"),
      ext: ext || undefined,
    });
  }
  return out;
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

  // --- Body: Show-Text als BLOCK-Struktur (Fix #10, Ziel 2): eine Zeile
  //     der Beschreibung = ein eigener <p> (bzw. Listen-Zeile), alles via
  //     textContent — kein innerHTML (ADR-0008: kein HTML-Injection-Pfad).
  const body = document.createElement("div");
  body.className = EXERCISE_DETAIL_CLASS.body;
  const bodyLineList = opts.bodyText ? exerciseBodyLines(opts.bodyText) : [];
  if (bodyLineList.length > 0) {
    for (const line of bodyLineList) {
      const el = document.createElement(line.startsWith("• ") ? "li" : "p");
      el.className = `${EXERCISE_DETAIL_CLASS.body}-line`;
      el.textContent = line;
      body.appendChild(el);
    }
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
  // #10-Kritik (User 29.09.2026, "keine Abgabe mehr"): das Submit-UI war
  // KOMPLETT weg bei optin=false — nur eine missverständliche Statuszeile.
  // Fix: Abgabe-Bereich IMMER sichtbar (disabled + klare Aktivierungs-
  // Meldung, wenn Optin fehlt). Kein stiller Block.
  const doneHint = (opts.bodyText ?? "").includes("als erledigt markiert");
  const status = document.createElement("div");
  status.className = EXERCISE_DETAIL_CLASS.status;
  status.textContent = doneHint
    ? "Die Aufgabe ist auf IServ bereits als erledigt markiert — keine Abgabe nötig."
    : opts.canSubmitText
      ? "Text-Abgabe an IServ möglich (Bestätigung unten)."
      : "Kein Abgabe-Formular auf IServ gefunden (bereits abgegeben oder ohne Rechte) oder die Aufgabenseite ließ sich nicht laden.";

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
  // --- Anhänge (User-Kritik 29.09.2026: Anhänge müssen verfügbar sein).
  // Liste mit Name + ext; Klick → Caller-Pipeline (Preview/Download);
  // kein aktiver Content gerendert (nur Buttons/Text — ADR-0008).
  // Issue #17-P1 (User-Feedback 08.10 nach Live-Gate): „Lehrkraft-Anlagen“
  // war eine ÜBERTREIBUNG — IServ listet im Show-HTML ALLE Datei-Elemente
  // strukturidentisch (batch-Checkbox + exercise-dl-Link, kein Owner-Feld);
  // eigene Uploads (Spike-Beweis 17433) erscheinen identisch. Server bietet
  // keine Teacher/Student-Semantik → neutraler Labelname (keine behauptete
  // falsche Unterscheidung). Upload-Block (eigene Abgabedateien) bleibt
  // DOM-strikt getrennt (c9b3d23), das ist die Trennung, die beweisbar ist.
  const atts = opts.attachments ?? [];
  if (atts.length > 0) {
    const attBlock = document.createElement("div");
    attBlock.className = `${EXERCISE_DETAIL_CLASS.root}-attachments`;
    const attHead = document.createElement("div");
    attHead.className = `${EXERCISE_DETAIL_CLASS.root}-attachments-head`;
    attHead.textContent = `Anhänge (${atts.length})`;
    attBlock.appendChild(attHead);
    for (const att of atts) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `${EXERCISE_DETAIL_CLASS.root}-attachment`;
      row.textContent = `📎 ${att.name}${att.ext ? ` (${att.ext})` : ""}`;
      row.addEventListener("click", () => opts.onOpenAttachment?.(att));
      attBlock.appendChild(row);
    }
    root.appendChild(attBlock);
  }

  // --- Issue #15: Datei-Upload (eigene Abgabedateien — STRIKT GETRENNT vom
  // Lehrkraft-Block). Nativer Datei-Dialog via hidden <input type=file>;
  // Vault-File-Wahl folgt optional (Caller-Entscheid). Vor dem Confirm
  // zählt der Upload als vom User beantragt (bestehende Checkbox-Gate-Kette).
  const pickedLabel = document.createElement("div");
  pickedLabel.className = `${EXERCISE_DETAIL_CLASS.root}-picked-files`;
  pickedLabel.textContent = "";
  pickedLabel.style.display = "none";

  if (opts.canUploadFiles && !doneHint) {
    const uploadLabel = document.createElement("div");
    uploadLabel.className = EXERCISE_DETAIL_CLASS.submitLabel;
    uploadLabel.textContent = "Eigene Abgabedateien (Upload)";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.className = `${EXERCISE_DETAIL_CLASS.root}-file-input`;
    fileInput.style.display = "none";

    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = `${EXERCISE_DETAIL_CLASS.root}-btn ${EXERCISE_DETAIL_CLASS.root}-upload-btn`;
    uploadBtn.textContent = "Dateien auswählen …";
    uploadBtn.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files ?? []);
      if (files.length === 0) return;
      const names = files.map((f) => f.name).join(", ");
      pickedLabel.textContent = `Ausgewählt: ${names}`;
      pickedLabel.style.display = "";
      opts.onPickFiles?.(files);
      // Reset, damit dieselbe Auswahl erneut gewählt werden kann.
      fileInput.value = "";
    });

    root.appendChild(uploadLabel);
    root.appendChild(uploadBtn);
    root.appendChild(fileInput);
    root.appendChild(pickedLabel);
  }

  root.appendChild(status);
  // #10-Fix: Submit-IMMER sichtbar (disabled bei fehlendem Formular — kein
  // stiller Block). Bei doneHint bleibt die UI dsabled mit Hinweis oben.
  if (!doneHint) {
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
    opts.handle.setPickedFiles = (label) => {
      pickedLabel.textContent = label;
      pickedLabel.style.display = label ? "" : "none";
    };
  }
}

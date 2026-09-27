/**
 * Fachindex-Ansicht + Noteneintrag-Modal (T10 F3, ADR-0006/0008) —
 * obsidian-freies Modul (Seam-Split à la ADR-0007): rendert die
 * Index-Tabelle und das Eingabe-Formular; Modal-Öffnung wired main.ts.
 *
 * Render-Funktionen nehmen Callbacks an (onEntry / onSubmit) statt Obsidian-
 * Klassen — der Tenant bleibt DOM-pure.
 */
import type { GradeEntry, GradeIndexData } from "../exams/grade-store";
import { isValidPoints } from "../exams/grade-store";
import type { GradeScale } from "../exams/prep-window";

export interface GradeIndexEntryInfo {
  subject: string;
  examTitle: string;
  date: string;
}

/** Tabelle Fach | Noten | Durchschnitt für die Index-Ansicht. */
export function renderGradeIndex(
  container: HTMLElement,
  grades: GradeIndexData,
  options: {
    onEntry?: (entry: GradeIndexEntryInfo) => void;
    scale?: GradeScale;
  } = {}
): void {
  container.replaceChildren();

  const root = document.createElement("div");
  root.className = "iserv-grade-index";

  const empty = document.createElement("div");
  empty.className = "iserv-grade-index-empty";
  empty.textContent =
    "Noch keine Noten eingetragen. Nach einer Arbeit erscheint hier der Fachindex.";
  root.appendChild(empty);

  const table = document.createElement("table");
  table.className = "iserv-grade-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Fach", "Noten", "Durchschnitt"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  const subjects = Object.keys(grades).sort((a, b) =>
    a.localeCompare(b, "de")
  );
  for (const subject of subjects) {
    const entries = grades[subject];
    if (!entries || entries.length === 0) continue;

    const tr = document.createElement("tr");
    tr.className = "iserv-grade-row";
    tr.dataset.subject = subject;

    const tdSubject = document.createElement("td");
    tdSubject.className = "iserv-grade-subject";
    tdSubject.textContent = subject;

    const tdNoten = document.createElement("td");
    tdNoten.className = "iserv-grade-notes";
    for (const entry of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "iserv-grade-entry-btn";
      btn.textContent = formatEntry(entry);
      btn.title = "Noteneintrag öffnen";
      btn.addEventListener("click", () => {
        options.onEntry?.({
          subject,
          examTitle: entry.examTitle,
          date: entry.date,
        });
      });
      tdNoten.appendChild(btn);
    }

    const tdAvg = document.createElement("td");
    tdAvg.className = "iserv-grade-avg";
    const avg = computeDisplayAverage(entries);
    tdAvg.textContent = avg === null ? "–" : formatNumber(avg);
    if (avg !== null) tdAvg.title = `Durchschnitt ${formatNumber(avg)} P (Scale 0–15)`;

    tr.appendChild(tdSubject);
    tr.appendChild(tdNoten);
    tr.appendChild(tdAvg);
    tbody.appendChild(tr);
  }
  table.appendChild(thead);
  table.appendChild(tbody);
  root.appendChild(table);
  container.appendChild(root);
}

function formatEntry(e: GradeEntry): string {
  const part = e.examTitle || "(ohne Titel)";
  const datePart = e.date ? ` (${e.date})` : "";
  const valuePart = e.scale === "grades" ? `${e.points}` : `${formatNumber(e.points)} P`;
  return `${part}${datePart}: ${valuePart}`;
}

/** Anzeige-Durchschnitt je Zeile: 'noten' wird zu 0–15 normalisiert, gerundet auf 1 Dez. */
export function computeDisplayAverage(entries: GradeEntry[]): number | null {
  if (entries.length === 0) return null;
  const sum = entries.reduce(
    (acc, e) => acc + normalizeToPoints(e.points, e.scale),
    0
  );
  return Math.round((sum / entries.length) * 10) / 10;
}

/** Note 1–6 → Punkte 0–15 (linear: Note 1 = 15 P … Note 6 = 0 P, wie T9-Endpunkte). */
function normalizeToPoints(value: number, scale: GradeScale): number {
  if (scale === "grades") {
    const clamped = Math.max(1, Math.min(6, value));
    return 15 - ((clamped - 1) * 15) / 5;
  }
  return value;
}

function formatNumber(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

export interface GradeEntryExamInfo {
  subject: string;
  examTitle: string;
  date: string;
}

export interface GradeSubmitValue {
  points: number;
  scale: GradeScale;
}

/**
 * Modal-Inhalt (obsidian-frei): Punkteeingabe 0–15 je Scale 'punkte' bzw.
 * Noten 1–6 je Scale 'noten' (Setting gradesScale, ADR-0006) mit Validierung.
 * Nach Submit feuert onSubmit mit {points, scale} ('noten': ganzzahlig).
 */
export function renderGradeEntryModal(
  container: HTMLElement,
  examInfo: GradeEntryExamInfo,
  options: {
    scale: GradeScale;
    onSubmit: (value: GradeSubmitValue) => void;
  }
): void {
  container.replaceChildren();
  const scale = options.scale;
  const isGrades = scale === "grades";

  const root = document.createElement("div");
  root.className = "iserv-grade-entry-modal";

  const info = document.createElement("div");
  info.className = "iserv-grade-entry-info";
  info.textContent = `${examInfo.subject} — ${examInfo.examTitle}`;
  root.appendChild(info);

  const dateLine = document.createElement("div");
  dateLine.className = "iserv-grade-entry-date";
  dateLine.textContent = examInfo.date || "(ohne Datum)";
  root.appendChild(dateLine);

  const label = document.createElement("label");
  label.className = "iserv-grade-entry-label";
  const input = document.createElement("input");
  input.type = "number";
  input.className = "iserv-grade-entry-input";
  input.min = isGrades ? "1" : "0";
  input.max = isGrades ? "6" : "15";
  input.step = isGrades ? "1" : "0.5";
  label.appendChild(document.createTextNode(isGrades ? "Note (1–6): " : "Punkte (0–15): "));
  label.appendChild(input);
  root.appendChild(label);

  const error = document.createElement("div");
  error.className = "iserv-grade-entry-error";
  error.style.display = "none";
  root.appendChild(error);

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "iserv-grade-entry-submit";
  submit.textContent = "Eintragen";
  submit.addEventListener("click", () => {
    const raw = input.value.trim();
    const points = Number(raw);
    const invalid =
      raw === "" ||
      !Number.isFinite(points) ||
      (isGrades && !Number.isInteger(points)) ||
      !isValidPoints(points, scale);
    if (invalid) {
      error.textContent = isGrades
        ? "Bitte eine ganze Note zwischen 1 und 6 eingeben."
        : "Bitte Punktzahl zwischen 0 und 15 eingeben.";
      error.style.display = "";
      return;
    }
    error.style.display = "none";
    options.onSubmit({ points, scale });
  });
  root.appendChild(submit);

  container.appendChild(root);
}

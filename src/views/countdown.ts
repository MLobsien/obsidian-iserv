/**
 * Countdown-Panel (T19, ADR-0006/0008): "Arbeiten & Countdown" — zeilenweise
 * Titel, Status-Badge (Farbcodierung), "X Tage", Klick auf Badge = Status-Cycle.
 * Klick auf Badge → onStatusChange Callback; Status manuell override-bar für
 * jeden Status jederzeit (ADR-0006 F5). Obsidian-frei (ADR-0008-Pattern, DOM
 * rein/DOM raus, testbar ohne Obsidian wie dashboard-render.ts).
 */
import { computeStatus, cycleStatus, type ExamStatus } from "../exams/exam-status";
import type { ExamType } from "../exams/template";

/** Zeilendaten-Contract: Status wird per computeStatus abgeleitet. */
export interface CountdownItem {
  id: string;
  title: string;
  type?: ExamType;
  /** Termin (examDate). */
  date: Date;
  /** Fachpunkte (default 15). */
  points?: number;
  /** Importierter Status (Frontmatter): als Compute-Override (ADR-0006). */
  status?: ExamStatus | string;
}

export interface CountdownOptions {
  /** Status-Änderung durch Badge-Klick (Cycle, ADR-0006 F5). */
  onStatusChange?(examId: string, newStatus: ExamStatus): void;
}

/** Referenzdatum für Countdown + Fenster-Ableitung (Render testebar). */
export interface CountdownRenderContext {
  now?: Date;
}

export const STATUS_BADGE_CLASS: Record<ExamStatus, string> = {
  geplant: "iserv-countdown-status-geplant", // muted
  "in-vorbereitung": "iserv-countdown-status-in-vorbereitung", // accent
  fertig: "iserv-countdown-status-fertig", // success
  verschoben: "iserv-countdown-status-verschoben", // warning
};

const STATUS_LABEL: Record<ExamStatus, string> = {
  geplant: "geplant",
  "in-vorbereitung": "in Vorbereitung",
  fertig: "fertig",
  verschoben: "verschoben",
};

function daysLabel(daysLeft: number): string {
  if (daysLeft <= 0) return "heute";
  return `${daysLeft} Tag${daysLeft === 1 ? "" : "e"}`;
}

/** Panel "Arbeiten & Countdown": eine Zeile pro Arbeit (Titel, Badge, X Tage). */
export function renderCountdownPanel(
  container: HTMLElement,
  exams: CountdownItem[],
  opts: CountdownOptions = {},
  ctx: CountdownRenderContext = {}
): void {
  const now = ctx.now ?? new Date();

  const panel = document.createElement("div");
  panel.className = "iserv-countdown";

  const header = document.createElement("div");
  header.className = "iserv-countdown-header";
  const title = document.createElement("span");
  title.className = "iserv-countdown-title";
  title.textContent = "Arbeiten & Countdown";
  header.appendChild(title);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "iserv-countdown-body";
  panel.appendChild(body);

  if (exams.length === 0) {
    const empty = document.createElement("div");
    empty.className = "iserv-empty-text";
    empty.textContent = "Keine Arbeiten";
    body.appendChild(empty);
    container.appendChild(panel);
    return;
  }

  for (const exam of exams) {
    const status: ExamStatus = computeStatus(
      {
        id: exam.id,
        type: exam.type,
        date: exam.date,
        points: exam.points,
        // Override: importierter Status (Frontmatter) gewinnt (ADR-0006 F5)
        status: exam.status,
      },
      now
    );

    const row = document.createElement("div");
    row.className = "iserv-countdown-row";
    row.dataset.id = exam.id;

    const label = document.createElement("span");
    label.className = "iserv-countdown-label";
    label.textContent = exam.title;

    const badge = document.createElement("span");
    badge.className = `iserv-countdown-status ${STATUS_BADGE_CLASS[status]}`;
    badge.setAttribute("role", "button");
    badge.textContent = STATUS_LABEL[status];
    badge.title = "Klicken: Status wechseln";
    badge.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const next = cycleStatus(status);
      opts.onStatusChange?.(exam.id, next);
    });

    const days = document.createElement("span");
    days.className = "iserv-countdown-days";
    const day = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.getTime();
    };
    const daysLeft = Math.max(
      0,
      Math.ceil((day(exam.date) - day(now)) / 86_400_000)
    );
    days.textContent = daysLabel(daysLeft);

    row.appendChild(label);
    row.appendChild(badge);
    row.appendChild(days);
    body.appendChild(row);
  }

  container.appendChild(panel);
}

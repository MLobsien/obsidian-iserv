/**
 * "Aktuelles"-Sektion: offene Aufgaben (R6, worker snail2/sidebar-exercise-
 * section). Kompakte Zeilen-Cards wie Review-Queue (ADR-0008) — obsidian-frei
 * (Seam-Split à la ADR-0007), Node-testbar.
 *
 * Leere Liste → KEINE Sektion (ADR-0008: leere Sektion entfällt).
 */
import type { ExerciseCandidate } from "../review-queue/exercise-feed";

/** Kompakte Aufgaben-Zeile: 📋 + Titel + Kurs + Frist, ganze Zeile klickbar. */
export function renderExerciseSection(
  container: HTMLElement,
  exercises: ExerciseCandidate[],
  onClick?: (e: ExerciseCandidate) => void
): void {
  if (exercises.length === 0) return; // ADR-0008: leere Sektion entfällt

  const section = document.createElement("div");
  section.className = "iserv-section iserv-exercises";

  const header = document.createElement("div");
  header.className = "iserv-section-header";
  header.setAttribute("role", "button");
  header.setAttribute("aria-expanded", "true");

  const label = document.createElement("span");
  label.className = "iserv-section-title";
  label.textContent = `Aufgaben (${exercises.length})`;

  const chevron = document.createElement("span");
  chevron.className = "iserv-chevron";
  chevron.textContent = "▾";

  header.appendChild(label);
  header.appendChild(chevron);

  const body = document.createElement("div");
  body.className = "iserv-section-body";

  header.addEventListener("click", () => {
    const collapsed = section.classList.toggle("iserv-collapsed");
    header.setAttribute("aria-expanded", String(!collapsed));
    chevron.textContent = collapsed ? "▸" : "▾";
  });

  for (const ex of exercises) {
    const row = document.createElement("div");
    row.className = "iserv-exercise-row";
    row.dataset.id = ex.id;

    const icon = document.createElement("span");
    icon.className = "iserv-exercise-icon";
    icon.textContent = "📋";

    const name = document.createElement("span");
    name.className = "iserv-exercise-name";
    name.textContent = ex.name;

    const subject = document.createElement("span");
    subject.className = "iserv-exercise-subject";
    subject.textContent = ex.subject ?? "";

    const due = document.createElement("span");
    due.className = "iserv-exercise-due";
    due.textContent = ex.dueDate ?? "";

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(subject);
    row.appendChild(due);

    if (onClick) {
      row.classList.add("iserv-exercise-row-clickable");
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", `Aufgabe öffnen: ${ex.name}`);
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onClick(ex);
      });
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onClick(ex);
        }
      });
    }

    body.appendChild(row);
  }

  section.appendChild(header);
  section.appendChild(body);
  container.appendChild(section);
}

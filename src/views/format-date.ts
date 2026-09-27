/**
 * Menschlesbares Mail-Datum (Q4-Entscheidung 2026-09-27):
 * - Heute:  "Heute, 14:32"
 * - Morgen: "Morgen, 08:05"
 * - Dieses Jahr: "Mo., 28.09. 14:32"
 * - Anderes Jahr: "28.09.2025 14:32"
 * Ungültige Eingaben werden unverändert zurückgegeben.
 */
export function formatMailDate(
  date: Date | string | undefined,
  now: Date = new Date()
): string {
  if (date === undefined || date === "") return date === "" ? "" : "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return String(date);

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();

  const time = d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const timeSuffix = `, ${time}`;

  if (sameDay) return `Heute${timeSuffix}`;
  if (isTomorrow) return `Morgen${timeSuffix}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) {
    const wdRaw = d.toLocaleDateString("de-DE", { weekday: "short" });
    const wd = wdRaw.endsWith(".") ? wdRaw : `${wdRaw}.`;
    const dm = d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
    });
    return `${wd}, ${dm} ${time}`;
  }
  const dmY = d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${dmY} ${time}`;
}

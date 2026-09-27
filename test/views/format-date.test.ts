import { describe, expect, it } from "vitest";
import { formatMailDate } from "../../src/views/format-date";

describe("formatMailDate", () => {
  it("heutige Mails: 'Heute, 14:32'", () => {
    const now = new Date("2026-09-28T15:00:00");
    const mail = new Date("2026-09-28T14:32:00");
    expect(formatMailDate(mail, now)).toBe("Heute, 14:32");
  });

  it("Morgen: 'Morgen, 08:05'", () => {
    const now = new Date("2026-09-28T15:00:00");
    expect(formatMailDate(new Date("2026-09-29T08:05:00"), now)).toBe(
      "Morgen, 08:05"
    );
  });

  it("dieses Jahr: 'Mo., 28.09. 14:32'", () => {
    const now = new Date("2026-09-30T15:00:00");
    expect(formatMailDate(new Date("2026-09-28T14:32:00"), now)).toBe(
      "Mo., 28.09. 14:32"
    );
  });

  it("altes Jahr: '28.09.2025 14:32'", () => {
    const now = new Date("2026-09-30T15:00:00");
    expect(formatMailDate(new Date("2025-09-28T14:32:00"), now)).toBe(
      "28.09.2025 14:32"
    );
  });

  it("IServ-API-String (ISO) funktioniert direkt", () => {
    const now = new Date("2026-09-30T15:00:00");
    expect(formatMailDate("2026-09-28T14:32:00+02:00", now)).toContain("28.09.");
  });

  it("ungültiges Datum → Original-String", () => {
    expect(formatMailDate("nix", new Date())).toBe("nix");
    expect(formatMailDate("", new Date())).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { buildQueueTargetPath } from "../../src/review-queue/template";
import type { QueueItem } from "../../src/review-queue/state";

function item(name: string, subject = ""): QueueItem {
  return {
    id: "x",
    name,
    path: "/dl/" + name,
    hash: "abc12345",
    subject,
    status: "neu",
  };
}

describe("buildQueueTargetPath", () => {
  it("nutzt das Queue-Fach, wenn gesetzt", () => {
    const p = buildQueueTargetPath(item("Blatt 5.pdf", "Mathematik"), {
      vaultSubjects: ["Mathematik", "Geschichte"],
    });
    expect(p).toBe("Mathematik/Material/2025-2026".replace("2025-2026", schoolYear()));
  });

  it("vermutet das Fach per ADR-0001-Norm-Match", () => {
    const p = buildQueueTargetPath(item("Geschichte-Quellenanalyse.pdf"), {
      vaultSubjects: ["Mathematik", "Geschichte"],
    });
    expect(p.startsWith("Geschichte/Material/")).toBe(true);
  });

  it("fällt auf Allgemein zurück, wenn kein Match", () => {
    const p = buildQueueTargetPath(item("Unbekannt.pdf"), {
      vaultSubjects: ["Mathematik"],
    });
    expect(p.startsWith("Allgemein/Material/")).toBe(true);
  });

  it("respektiert ein Custom-Template", () => {
    const p = buildQueueTargetPath(item("Blatt.pdf", "Latein"), {
      vaultSubjects: ["Latein"],
      template: "{{SUBJECT}}/{{SCHOOLYEAR}}/{{FILENAME}}",
    });
    expect(p).toBe(`Latein/${schoolYear()}/Blatt.pdf`);
  });

  it("sanitisiert illegale Zeichen weg", () => {
    const p = buildQueueTargetPath(item('a<b>:c?.pdf', "Mathematik"), {
      vaultSubjects: ["Mathematik"],
      template: "{{SUBJECT}}/{{FILENAME}}",
    });
    expect(p).toBe("Mathematik/abc.pdf");
  });

  // Issue #7 (29.09.2026): RAW-Gruppenordner-Anker als LETZTER Fallback der
  // Vermutungs-Kette — der Kursname ist EXAKT der Files-Ordner unter Groups/
  // (herb, f3e03fa R2), also der authentischste Bearer, wenn Queue-Fach fehlt
  // und der Dateiname nichts hergibt. Entscheidung: subject-Chain statt
  // eigener target-Ebene ({{SUBJECT}} bleibt Vault-Fach, nie RAW-Gruppenname).
  it("Issue #7: leeres Queue-Fach + nicht-matchender Dateiname → RAW-Gruppen-Segment matcht Vault-Fach", () => {
    const it7: QueueItem = {
      id: "i7",
      name: "Arbeitsblatt-07.pdf",
      path: "Groups/O Informatik 12gN Sz/Arbeitsblatt-07.pdf",
      hash: "h",
      subject: "",
      status: "neu",
    };
    const p = buildQueueTargetPath(it7, {
      vaultSubjects: ["Informatik", "Mathematik"],
    });
    expect(p.startsWith("Informatik/Material/")).toBe(true);
  });

  it("Issue #7: Gruppen-Fallback greift NICHT, wenn das Queue-Fach schon gesetzt ist", () => {
    const it7b: QueueItem = {
      id: "i7b",
      name: "Blatt.pdf",
      path: "Groups/O Informatik 12gN Sz/Blatt.pdf",
      hash: "h",
      subject: "Kunst",
      status: "neu",
    };
    const p = buildQueueTargetPath(it7b, {
      vaultSubjects: ["Informatik", "Kunst"],
    });
    expect(p.startsWith("Kunst/Material/")).toBe(true);
  });
});

function schoolYear(): string {
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  return m >= 7 ? `${y}/${String(y + 1).slice(-2)}` : `${y - 1}/${String(y).slice(-2)}`;
}

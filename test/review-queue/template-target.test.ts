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
});

function schoolYear(): string {
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  return m >= 7 ? `${y}/${String(y + 1).slice(-2)}` : `${y - 1}/${String(y).slice(-2)}`;
}

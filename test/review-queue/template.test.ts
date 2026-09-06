import { describe, it, expect } from "vitest";
import {
  TemplateVars,
  resolveTemplate,
  getDefaultTemplate,
  calculateSchoolYear,
  sanitizePath,
  addCollisionSuffix,
} from "../../src/review-queue/template";

describe("resolveTemplate", () => {
  it("replaces all variables", () => {
    const template = "{{SUBJECT}}/{{COURSE}}/{{DATE}}/{{TIME}}/{{SCHOOLYEAR}}/{{TEACHER}}/{{FILENAME}}";
    const vars: TemplateVars = {
      subject: "Mathe",
      course: "10a",
      date: "2026-09-05",
      time: "08:00",
      schoolyear: "2026/27",
      teacher: "Mueller",
      filename: "aufgabe.pdf",
    };

    const result = resolveTemplate(template, vars);
    expect(result).toBe("Mathe/10a/2026-09-05/08:00/2026/27/Mueller/aufgabe.pdf");
  });

  it("handles missing variables gracefully", () => {
    const template = "{{SUBJECT}}/Material/{{SCHOOLYEAR}}";
    const vars: TemplateVars = { subject: "Mathe" };

    const result = resolveTemplate(template, vars);
    expect(result).toBe("Mathe/Material/");
  });

  it("returns template unchanged when no variables present", () => {
    const template = "plain/path/here";
    const result = resolveTemplate(template, {});
    expect(result).toBe("plain/path/here");
  });
});

describe("getDefaultTemplate", () => {
  it("returns expected format", () => {
    const tpl = getDefaultTemplate();
    expect(tpl).toBe("{{SUBJECT}}/Material/{{SCHOOLYEAR}}");
  });
});

describe("calculateSchoolYear", () => {
  it("August → new school year (YYYY/YY+1)", () => {
    const aug = new Date("2026-08-01");
    expect(calculateSchoolYear(aug)).toBe("2026/27");
  });

  it("September → new school year", () => {
    const sep = new Date("2026-09-15");
    expect(calculateSchoolYear(sep)).toBe("2026/27");
  });

  it("December → new school year", () => {
    const dec = new Date("2026-12-25");
    expect(calculateSchoolYear(dec)).toBe("2026/27");
  });

  it("July → old school year", () => {
    const jul = new Date("2026-07-31");
    expect(calculateSchoolYear(jul)).toBe("2025/26");
  });

  it("January → old school year", () => {
    const jan = new Date("2026-01-15");
    expect(calculateSchoolYear(jan)).toBe("2025/26");
  });

  it("June → old school year", () => {
    const jun = new Date("2026-06-30");
    expect(calculateSchoolYear(jun)).toBe("2025/26");
  });

  it("year boundary: December 2025 → 2025/26", () => {
    const dec25 = new Date("2025-12-01");
    expect(calculateSchoolYear(dec25)).toBe("2025/26");
  });

  it("year boundary: January 2025 → 2024/25", () => {
    const jan25 = new Date("2025-01-10");
    expect(calculateSchoolYear(jan25)).toBe("2024/25");
  });
});

describe("sanitizePath", () => {
  it("removes invalid characters", () => {
    expect(sanitizePath('test<>:"|?*.md')).toBe("test.md");
  });

  it("collapses multiple slashes", () => {
    expect(sanitizePath("a//b///c")).toBe("a/b/c");
  });

  it("trims leading and trailing slashes", () => {
    expect(sanitizePath("/path/to/file/")).toBe("path/to/file");
  });

  it("preserves clean paths", () => {
    expect(sanitizePath("Mathe/Material/2026/27")).toBe("Mathe/Material/2026/27");
  });
});

describe("addCollisionSuffix", () => {
  it("appends hash to filename", () => {
    const result = addCollisionSuffix("Mathe/file.md", "abcdef1234567890");
    expect(result).toBe("Mathe/file.md(abcdef12)");
  });

  it("works without directory", () => {
    const result = addCollisionSuffix("file.md", "deadbeef");
    expect(result).toBe("file.md(deadbeef)");
  });

  it("handles deep paths", () => {
    const result = addCollisionSuffix("a/b/c/file.md", "12345678");
    expect(result).toBe("a/b/c/file.md(12345678)");
  });
});

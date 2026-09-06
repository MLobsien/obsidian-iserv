export interface TemplateVars {
  subject?: string;
  course?: string;
  date?: string;
  time?: string;
  schoolyear?: string;
  teacher?: string;
  filename?: string;
}

export function resolveTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const lowerKey = key.toLowerCase() as keyof TemplateVars;
    return vars[lowerKey] ?? "";
  });
}

export function getDefaultTemplate(): string {
  return "{{SUBJECT}}/Material/{{SCHOOLYEAR}}";
}

export function calculateSchoolYear(date: Date): string {
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();

  if (month >= 7) {
    // August or later → new school year
    const yy = String(year).slice(-2);
    const yyNext = String(year + 1).slice(-2);
    return `${year}/${yyNext}`;
  } else {
    // Before August → old school year
    const yyPrev = String(year - 1).slice(-2);
    const yy = String(year).slice(-2);
    return `${year - 1}/${yy}`;
  }
}

export function sanitizePath(path: string): string {
  // Remove invalid filesystem characters
  let sanitized = path.replace(/[<>:"|?*\x00-\x1f]/g, "");
  // Collapse multiple slashes
  sanitized = sanitized.replace(/\/{2,}/g, "/");
  // Trim leading/trailing slashes
  sanitized = sanitized.replace(/^\/+|\/+$/g, "");
  return sanitized;
}

export function addCollisionSuffix(path: string, hash: string): string {
  const shortHash = hash.slice(0, 8);
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return `${path}(${shortHash})`;
  }
  const dir = path.slice(0, lastSlash);
  const file = path.slice(lastSlash + 1);
  return `${dir}/${file}(${shortHash})`;
}

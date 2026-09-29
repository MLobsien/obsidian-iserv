/**
 * Dateibrowser im Dashboard (Issue #11) — NUR Gruppenordner (Root /iserv/Groups).
 *
 * Obsidian-frei (Seam-Split à la ADR-0007/0008, jsdom-testbar): dieser Renderer
 * kennt keinen IServClient — die Listing-Daten (file/api/list/<pfad>, live
 * verifiziert 28.09.2026) liefert der Koordinator (refreshDashboard in main.ts)
 * mit dem selben Parse-Pfad wie den Review-Queue-Feed (files-feed.ts), KEIN
 * Doppelaufbau. Klick auf eine Datei → Callback an main.ts, die die bestehende
 * Preview-Pipeline (PdfViewerModal, Bild/Other-Zweige) über openPdfPreview
 * startet — kein zweiter Viewer.
 *
 * Maße („klein", User): kompakte Sektion, klickbare Breadcrumb-Zeile, Ordner
 * und Dateien als Liste (Ordner zuerst, sonst Sortierung wie vom Server),
 * Lazy-Navigation — jede Ebene wird erst bei Klick gelistet (kein Baum-_bulk).
 * Mobile (ADR-0009): Listing braucht Session/Netz — falls `files` nicht
 * geliefert wird, entfällt die Sektion (kein Teilaufbau).
 */
import type { FileEntry } from "../review-queue/files-feed";

/** Groups-Root des Dateibrowsers (Gleich wie QUEUE_FEED_ROOT in files-feed). */
export const FILES_BROWSER_ROOT = "Groups";

/** Sektions-Data-Contract (DashboardData.files). State (cwd) liegt im ViewModel. */
export interface FilesBrowserData {
  /** IServ-Ordnerpfad relativ zum Pool-Root (z. B. 'Groups' oder 'Groups/Physik'). */
  cwd: string;
  entries: FileEntry[];
  loading?: boolean;
  /** Fehltext der Listing-Anfrage (fail-soft, Sektion bleibt renderbar). */
  error?: string;
  /**
   * Ordner/Breadcrumb-Klick: auf `path` navigieren (Koordinator fetcht die
   * Ebene neu und re-rendert).
   */
  onNavigate?(path: string): void;
  /**
   * Datei-Klick: item.path = voller IServ-Dateipfad (branch: <cwd>/<name>) —
   * main.ts baut daraus ein QueueItem-artiges Preview-Target (PdfViewerModal).
   */
  onFileOpen?(item: { id: string; name: string; path: string }): void;
}

/**
 * Breadcrumb-Segmente eines cwd relativ zum Groups-Root — `{ label, path }`
 * klickbar (Pfad-Reset auf Root via Erster-Crumb). Root antwortet mit
 * "Groups" (iserv-api.md Dateien-Sektion).
 */
export function filesBreadcrumb(
  cwd: string,
  root: string = FILES_BROWSER_ROOT
): { label: string; path: string }[] {
  const crumbPath = cwd.startsWith(root) ? cwd : `${root}/${cwd}`.replace(/\/+/g, "/");
  const rest = crumbPath.slice(root.length).replace(/^\/+/, "");
  const crumbs = [{ label: "Gruppen", path: root }];
  if (rest) {
    const segs = rest.split("/").filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      crumbs.push({ label: segs[i], path: `${root}/${segs.slice(0, i + 1).join("/")}` });
    }
  }
  return crumbs;
}

function typeId(type: FileEntry["type"]): string {
  return typeof type === "string" ? type : (type?.id ?? "");
}

function entryName(name: FileEntry["name"]): string {
  if (typeof name === "string") return name;
  return name?.text ?? "";
}

/**
 * Ordner zuerst, sonst Server-Reihenfolge stabil halten (kein Alphabet-Flip
 * gegenüber dem echten IServ-Manager).
 */
export function sortBrowserEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    const fa = typeId(a.type) === "Folder" ? 0 : 1;
    const fb = typeId(b.type) === "Folder" ? 0 : 1;
    return fa - fb;
  });
}

/** Sektionsklasse (styles.css) — eindeutiger Präfix iserv-files-browser. */
const CLASS = {
  crumbs: "iserv-files-browser-crumbs",
  crumb: "iserv-files-browser-crumb",
  sep: "iserv-files-browser-crumb-sep",
  row: "iserv-files-browser-row",
  rowFolder: "iserv-files-browser-row-folder",
  rowFile: "iserv-files-browser-row-file",
  name: "iserv-files-browser-name",
  size: "iserv-files-browser-size",
  status: "iserv-files-browser-status",
} as const;

function sizeLabel(size?: number): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Rendert die Dateibrowser-Sektion-Body (Breadcrumb + Einträge). Renderer ist
 * zustandsfrei: jede Navigation/Datei-Öffnung läuft über die Callbacks ins
 * ViewModel/main.ts. Fail-soft: leere/fehlerhafte Daten → dezente Leerenzeile.
 */
export function renderFilesBrowser(
  container: HTMLElement,
  data: FilesBrowserData
): void {
  // Breadcrumb-Zeile: klickbar bis zum Root (aktuelles Crumb ohne Klick-Wirkung).
  const crumbs = filesBreadcrumb(data.cwd);
  const crumbRow = document.createElement("div");
  crumbRow.className = CLASS.crumbs;
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = CLASS.sep;
      sep.textContent = "›";
      crumbRow.appendChild(sep);
    }
    const crumb = document.createElement("span");
    crumb.className = CLASS.crumb;
    crumb.textContent = c.label;
    const isCurrent = i === crumbs.length - 1;
    if (isCurrent) {
      crumb.classList.add("is-current");
    } else {
      crumb.setAttribute("role", "button");
      crumb.addEventListener("click", () => data.onNavigate?.(c.path));
    }
    crumbRow.appendChild(crumb);
  });
  container.appendChild(crumbRow);

  if (data.loading) {
    const status = document.createElement("div");
    status.className = CLASS.status;
    status.textContent = "Lade Ordner …";
    container.appendChild(status);
    return;
  }
  if (data.error) {
    const status = document.createElement("div");
    status.className = CLASS.status;
    status.textContent = data.error;
    container.appendChild(status);
    return;
  }
  if (data.entries.length === 0) {
    const status = document.createElement("div");
    status.className = CLASS.status;
    status.textContent = "Keine Einträge in diesem Ordner.";
    container.appendChild(status);
    return;
  }

  for (const entry of sortBrowserEntries(data.entries)) {
    const name = entryName(entry.name);
    if (!name) continue;
    const isFolder = typeId(entry.type) === "Folder";
    const row = document.createElement("div");
    row.className = `${CLASS.row} ${isFolder ? CLASS.rowFolder : CLASS.rowFile}`;
    row.setAttribute("role", "button");
    if (!isFolder) {
      const sz = sizeLabel(entry.size);
      if (sz) row.title = `${name} (${sz})`;
    }
    row.addEventListener("click", () => {
      if (isFolder) {
        // Ordnerpfad = <cwd>/<Name> (files-feed-Muster: path ist Breadcrumb
        // des Elters, NICHT der Kindordner).
        const child = `${data.cwd.replace(/\/+$/, "")}/${name}`;
        data.onNavigate?.(child);
      } else {
        data.onFileOpen?.({
          id: entry.id,
          name,
          path: `${data.cwd.replace(/\/+$/, "")}/${name}`,
        });
      }
    });

    const nameEl = document.createElement("span");
    nameEl.className = CLASS.name;
    nameEl.textContent = `${isFolder ? "▸ " : ""}${name}`;

    row.appendChild(nameEl);
    if (!isFolder && typeof entry.size === "number" && entry.size >= 0) {
      const szEl = document.createElement("span");
      szEl.className = CLASS.size;
      szEl.textContent = sizeLabel(entry.size);
      row.appendChild(szEl);
    }
    container.appendChild(row);
  }
}

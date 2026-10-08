/**
 * Konzept-NEU Folder-Reject-UI (Issue #12, Teil 2d): Ordner-Gruppierung der
 * offenen Queue-Items + per-Ordner-Verwerfen-Payload. Pure Layer (Node-testbar);
 * Render keeps in sidebar-render.ts, Persistenz via DeniedFoldersStore.
 *
 * Konzept: Ablehnung gilt für den GANZEN IServ-Ordner (und alles darunter) —
 * "Groups/O Latein 12gN Sz/Memes" ablehnen ⇒ Memes-Dateien sind ab dem
 * nächsten Feed weg, Bestand wird direkt verworfen (discarded). Fail-open:
 * leere/zerrüttete Gruppen erzeugen keine UI.
 *
 * Issue #19 P1: Kurs-Ebene — der Kurs-Kopf bekommt zusätzlich
 * "Kurs verwerfen" (courseDiscardPayload): deny auf den KURS-Ordner
 * ("Groups/<Kurs>", 1. Ebene unter dem Feed-Root). DeniedFoldersStore-
 * longest-prefix deckt damit ALLE Sub-Ordner des Kurses ab (Sub-Allows
 * mit längerem Präfix bleiben合法 gewinnt). Semantik identisch zum
 * Ordner-Verwerfen (Confirm-Modal, deny + discard) — nur größere Basis.
 */
import type { QueueItem } from "./state";
import { groupSegmentOf, QUEUE_FEED_ROOT } from "./files-feed";

/** Eine Ordner-Gruppe: IServ-Kursordner + offene Items darunter. */
export interface QueueFolderGroup {
  /** RAW-Gruppen-Segment (1. Ebene unter Groups), z. B. "O Latein 12gN Sz". */
  group: string;
  /** Offene (neu/unsure) Items dieser Gruppe. */
  items: QueueItem[];
}

/**
 * Offene Items nach Gruppen-Segment gruppieren (Reihenfolge: erster Auftreten,
 * wie der Feed sie liefert — Set bewahrt die Einfügungsreihenfolge).
 * Items ohne Gruppen-Segment (leer) laufen NICHT in eine Gruppe (Einzeln-Rows).
 */
export function groupQueueByFolder(
  queue: QueueItem[],
  isOpen: (item: QueueItem) => boolean = (i) => i.status === "neu" || i.status === "unsure"
): QueueFolderGroup[] {
  const groups = new Map<string, QueueFolderGroup>();
  for (const item of queue) {
    if (!isOpen(item)) continue;
    const path = item.path ?? "";
    if (!path.startsWith(`${QUEUE_FEED_ROOT}/`)) continue;
    const group = groupSegmentOf(path);
    if (!group) continue;
    let g = groups.get(group);
    if (!g) {
      g = { group, items: [] };
      groups.set(group, g);
    }
    g.items.push(item);
  }
  return [...groups.values()];
}

/**
 * Payload eines per-Folder-Verwerfens: ALLE offenen Item-IDs der Gruppe + der
 * IServ-Kursordner-Pfad (für DeniedFoldersStore.deny). subject der Items wird
 * NICHT angetastet (dies ist eine Ordner-Entscheidung, kein Fach-Review).
 */
export interface FolderDiscardPayload {
  group: string;
  itemIds: string[];
  /** IServ-Ordnerpfad inkl. Feed-Root, z. B. "Groups/O Latein 12gN Sz". */
  folderPath: string;
}

export function folderDiscardPayload(group: QueueFolderGroup): FolderDiscardPayload {
  return {
    group: group.group,
    itemIds: group.items.map((i) => i.id),
    folderPath: `${QUEUE_FEED_ROOT}/${group.group}`,
  };
}

/**
 * Issue #19 P1: Payload eines KURS-Verwerfens (Kurs-Kopf-Action). Identisch
 * zum folderDiscardPayload für die EINE-Kurs-Gruppe — der folderPath ist der
 * Kurs-Ordner selbst (1. Ebene unter dem Feed-Root); der Store-Deny deckt
 * über longest-prefix automatically ALLE Sub-Ordner ab (Sub-Allows bleiben).
 * Kein neuer Persist-Path nötig: UI-Text und Scope sind die einzige Differenz.
 */
export function courseDiscardPayload(group: QueueFolderGroup): FolderDiscardPayload {
  return folderDiscardPayload(group);
}

/**
 * Issue #17 Punkt 4: Sub-Ordner-Ebene — offene Items einer Gruppe nach dem
 * ZWEITEN Pfadsegment (Ordner unter dem Kurs) gruppieren, für den
 * "Erlauben/Verwerfen"-Feinschnitt innerhalb eines Kursordners. Pfadform:
 * "Groups/<KursOrdner>/<SubOrdner|Datei>" — Sub-Items tragen mind. 3 Segmente.
 */
export interface QueueSubFolderGroup {
  /** Kurs-Gruppen-Segment (1. Ebene unter Groups). */
  group: string;
  /** Sub-Ordner-Name (2. Ebene), z. B. "Lektion 7" oder "Memes". */
  sub: string;
  /** IServ-Ordnerpfad inkl. Feed-Root. */
  folderPath: string;
  items: QueueItem[];
}

export function groupQueueBySubFolder(group: QueueFolderGroup): QueueSubFolderGroup[] {
  const groups = new Map<string, QueueSubFolderGroup>();
  const root = `${QUEUE_FEED_ROOT}/${group.group}/`;
  for (const item of group.items) {
    const path = item.path ?? "";
    if (!path.startsWith(root)) continue;
    const rest = path.slice(root.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) continue; // Datei direkt im Kursordner → kein Sub-Ordner
    const sub = rest.slice(0, slash);
    let g = groups.get(sub);
    if (!g) {
      g = { group: group.group, sub, folderPath: `${root}${sub}`, items: [] };
      groups.set(sub, g);
    }
    g.items.push(item);
  }
  return [...groups.values()];
}

/**
 * Issue #19 P2 (User-Befund 15:33): die Sub-Zeilen zeigen ALLE Unterordner,
 * aus denen aktuell offene Dateien in der Queue liegen — die KOMPLETTE
 * Unterpfad-Liste relativ zum Kursordner (jede Verzweigungsebene), nicht
 * nur die 2. Ebene. Beispiel:
 *   Groups/O Latein 12gN Sz/Lektion 7/Grammatik.pdf   → "Lektion 7"
 *   Groups/O Latein 12gN Sz/AAG 25-26/1. Halbjahr/x.pdf → "AAG 25-26/1. Halbjahr"
 * Die folderPath bleibt der Ordner-Anteil des echten IServ-Pfads (Deny/
 * Allow-Präfix-Logik unverändert). Reihenfolge = erster Auftreten im Feed.
 * Dateien direkt im Kursordner erzeugen keine Zeile (Kurs-Kopf deckt sie).
 */
export function groupQueueBySubPath(group: QueueFolderGroup): QueueSubFolderGroup[] {
  const groups = new Map<string, QueueSubFolderGroup>();
  const root = `${QUEUE_FEED_ROOT}/${group.group}/`;
  for (const item of group.items) {
    const path = item.path ?? "";
    if (!path.startsWith(root)) continue;
    const rest = path.slice(root.length);
    const slash = rest.lastIndexOf("/");
    if (slash <= 0) continue; // Datei direkt im Kursordner → kein Sub-Pfad
    const sub = rest.slice(0, slash); // kompletter Ordner-Pfad unter dem Kurs
    let g = groups.get(sub);
    if (!g) {
      g = { group: group.group, sub, folderPath: `${root}${sub}`, items: [] };
      groups.set(sub, g);
    }
    g.items.push(item);
  }
  return [...groups.values()];
}

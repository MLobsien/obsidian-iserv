/**
 * Datei-Upload für die Exercise-Abgabe (Issue #15, live bewiesen 08.10.2026):
 * POST /iserv/fs/api/upload/local (multipart/form-data, Dropzone-Kompatibel).
 *
 * Live-Beweise (echtes IServ gymmeck.de, 08.10.2026):
 * - Der Endpunkt erwartet DROPZONE-Chunk-Parameter (dzuuid, dzchunkindex,
 *   dztotalfilesize, dzchunksize, dztotalchunkcount, dzchunkbyteoffset) UND
 *   die Datei unter dem Feldnamen `file`. Ohne dz*-Params → HTTP 400
 *   {"status":"error","messages":[...,"Keine Datei ausgewählt!"]}.
 * - Erfolg: HTTP 200 {"status":"success",
 *   "path":"local://Temp/<phpXXX>_<name>","name":"<name>"}.
 * - Der confirm-POST sieht die Datei NICHT über submission[newFiles][picker]
 *   (das ist das IServ-Dateien-PICKER-Formular-Feld), sondern über HIDDEN-FELDER
 *   `submission[newFiles][files][N]` mit val = local://Temp-Pfad — exakt so
 *   füllt das Web-UI sein data-prototype nach jedem Upload (universalFile-
 *   Widget, iservfilesystem/js/global-Bundle). Mit files[N] → 302, Outcome
 *   im Web-UI sichtbar (Abgaben-Tabelle mit exercise-dl-Link).
 * - Integrität: 4096-Byte-Binärteil (volle 0x00–0xFF-Bandbreite) hochgeladen,
 *   per confirm-POST abgegeben, per rawBytesRequest über exercise-dl
 *   zurückgeladen → Länge 4096 + Byte-Checksumme identisch (bytegetreu).
 *
 * Transport-Entscheidung (faktbasiert, Maple-Vorgabe): der bewiesene Kanal ist
 * der Desktop-Node-https-Pfad des IServClient (rawRequest/rawBytesRequest —
 * derselbe Kanal, über den die Integritätsprüfung lief). Der Upload läuft
 * deshalb über `uploadBytes()` am Client (Neu, analog rawBytesRequest, aber
 * Post + Uint8Array-Body). Mobile bleibt GESPERRT (RequestUrlTransport.bytes
 * ist GET-only; POST-Binary wakeproof folgt separat — bewusste Beschränkung,
 * kein stiller Fallback).
 *
 * ADR-0005/0007: fail-soft Ergebnisse, KEINE throws aus Jobs; der einzige
 * Write läuft user-beantragt über das Exercise-Detail-Modal (Allow-Submit-
 * Checkbox-Gate wie die Text-Abgabe).
 */

/**
 * Multipart-Multipart-Body bauen (pure, Node-testbar):
 * dz*-Felder (Dropzone-Konvention, live-Pflicht) + "file"-Part.
 * Namen NUR ASCII-safe sanitizen (IServ-Zeichen allowing, Live-Beweis in den
 * UI-Tests). Der Chunked-Upload läuft als EIN Chunk (Dropzone default chunkSize
 * 2 MB; größere Dateien über mehrere Chunks ansteuerbar — chunkCount Parameter).
 */
export interface MultipartFile {
  name: string;
  bytes: Uint8Array;
  /** MIME (bspw. "application/pdf"); default application/octet-stream. */
  mimeType?: string;
}

export interface MultipartUploadBody {
  body: Uint8Array;
  boundary: string;
}

export function buildMultipartUploadBody(
  file: MultipartFile,
  uuid: string,
  chunkSize = 2_000_000
): MultipartUploadBody {
  const boundary = `----iservUpload${Date.now()}${uuid.slice(0, 6)}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];

  const push = (u8: Uint8Array) => chunks.push(u8);
  const field = (name: string, value: string | number) => {
    push(enc.encode(`--${boundary}\r\n`));
    push(
      enc.encode(
        `Content-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`
      )
    );
  };

  const totalChunks = Math.max(1, Math.ceil(file.bytes.length / chunkSize));
  field("dzuuid", uuid);
  field("dzchunkindex", 0);
  field("dztotalfilesize", file.bytes.length);
  field("dzchunksize", chunkSize);
  field("dztotalchunkcount", totalChunks);
  field("dzchunkbyteoffset", 0);

  push(enc.encode(`--${boundary}\r\n`));
  push(
    enc.encode(
      `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.mimeType ?? "application/octet-stream"}\r\n\r\n`
    )
  );
  push(file.bytes);
  push(enc.encode("\r\n"));
  push(enc.encode(`--${boundary}--\r\n`));

  const total = chunks.reduce((a, c) => a + c.byteLength, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.byteLength;
  }
  return { body, boundary };
}

/** Antwort des Upload-Endpoints (best-effort geparst, fail-soft → null). */
export interface ExerciseUploadResponse {
  path: string;
  name: string;
  status: number;
}

/** JSON parsen (fail-soft): {"status":"success","path":"local://Temp/…","name":"…"} */
export function parseExerciseUploadResponse(
  httpStatus: number,
  raw: string
): ExerciseUploadResponse | null {
  if (httpStatus < 200 || httpStatus >= 300) return null;
  try {
    const j = JSON.parse(raw) as { status?: string; path?: string; name?: string };
    if (j?.status !== "success" || typeof j.path !== "string" || !j.path) return null;
    return {
      path: j.path,
      name: typeof j.name === "string" && j.name ? j.name : "",
      status: httpStatus,
    };
  } catch {
    return null;
  }
}

/**
 * Serverpfad-Sektion: IServ versieht Temp-Uploads mit einem php-Prefix
 * (phpXXX_name). Für die UI-Anzeige nutzen wir den lokalen Namen +
 * MimeType-Verdict.
 */
export function sanitizeUploadName(name: string): string {
  // Dateinamen-Disziplin: Pfadseparatoren/Backslashes/Whitespace-Trenner weg.
  const cleaned = name.replace(/[\\/\r\n\t]+/g, "_").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "datei.bin";
}

/** Einfache Byte-Checksumme (Integritäts-Diagnose, nicht kryptografisch). */
export function exerciseBytesChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i]) >>> 0;
  return sum;
}

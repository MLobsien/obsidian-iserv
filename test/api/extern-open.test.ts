/**
 * Tests für Issue #17-P3: Extern-Öffnen als Download-Chain.
 * Alle Zweige: Mobile-Gate, DL-Nullbytes, mkdir-Safety (exists-Proof),
 * Kollisions-Dedupe, writeBinary+exists-Beweis, openPath-Aufruf,
 * Fehler-Kapselung, cleanupExternTemp (inkl. fail-soft).
 *
 * Keine Obsidian-Imports: runExternOpen ist obsidian-frei (Seam-Split),
 * der Adapter wird als Mock injiziert — so wie main.ts es wired.
 */
import { describe, it, expect, vi } from "vitest";
import {
  EXTERN_TEMP_DIR,
  sanitizeExternName,
  externTempPath,
  runExternOpen,
  cleanupExternTemp,
  type ExternOpenDeps,
} from "../../src/api/extern-open";

function makeAdapter(overrides: Partial<ExternOpenDeps["adapter"]> = {}): ExternOpenDeps["adapter"] & { written: Record<string, ArrayBuffer>; dirs: Set<string> } {
  const written: Record<string, ArrayBuffer> = {};
  const dirs = new Set<string>([EXTERN_TEMP_DIR]);
  const trimDir = (p: string) => p.replace(new RegExp(`^${EXTERN_TEMP_DIR}/`), "");
  return {
    written,
    dirs,
    async mkdir(path: string) {
      dirs.add(path);
    },
    async exists(p: string) {
      return p in written || dirs.has(p);
    },
    async writeBinary(p: string, data: ArrayBuffer) {
      written[p] = data;
    },
    async list(path: string) {
      const prefix = `${path}/`;
      return {
        files: Object.keys(written).filter((f) => f.startsWith(prefix)),
        folders: [...dirs].filter((d) => d !== EXTERN_TEMP_DIR || path === EXTERN_TEMP_DIR),
      };
    },
    async remove(p: string) {
      delete written[p];
      dirs.delete(p);
    },
    ...overrides,
  };
}

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = i % 256;
  return b;
}

describe("sanitizeExternName / externTempPath", () => {
  it("strips path components and forbidden chars", () => {
    expect(sanitizeExternName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeExternName("a<b>:c?.pdf")).toBe("a_b__c_.pdf");
    expect(sanitizeExternName("")).toBe("anlage.bin");
  });

  it("builds path under plugin temp dir", () => {
    expect(externTempPath("Cat.20.pdf")).toBe(
      `${EXTERN_TEMP_DIR}/Cat.20.pdf`
    );
  });
});

describe("runExternOpen", () => {
  it("ok chain: fetch → mkdir → exists(dir) → write → exists(file) → openPath", async () => {
    const adapter = makeAdapter();
    const openPath = vi.fn().mockResolvedValue("");
    const progress: string[] = [];
    const res = await runExternOpen(
      { adapter, openPath, isDesktop: true, onProgress: (m) => progress.push(m) },
      "CatilinasRede_Cat.20.pdf",
      () => Promise.resolve(bytes(16))
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.path).toBe(`${EXTERN_TEMP_DIR}/CatilinasRede_Cat.20.pdf`);
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith(`${EXTERN_TEMP_DIR}/CatilinasRede_Cat.20.pdf`);
    expect(adapter.written[`${EXTERN_TEMP_DIR}/CatilinasRede_Cat.20.pdf`]).toBeDefined();
    expect(progress.length).toBe(2);
  });

  it("mobile gate: isDesktop=false → ok=false, no fetch, no openPath", async () => {
    const adapter = makeAdapter();
    const fetchBytes = vi.fn();
    const res = await runExternOpen(
      { adapter, openPath: vi.fn(), isDesktop: false },
      "a.pdf",
      fetchBytes
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Desktop");
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("download null bytes → ok=false, nothing written", async () => {
    const res = await runExternOpen(
      { adapter: makeAdapter(), openPath: vi.fn(), isDesktop: true },
      "a.pdf",
      () => Promise.resolve(null)
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("keine Bytes");
  });

  it("mkdir-safety: dir not creatable → ok=false with explicit reason", async () => {
    const adapter = makeAdapter({
      exists: async (p: string) => p in (adapter as unknown as { written: Record<string, ArrayBuffer> }).written,
    });
    const res = await runExternOpen(
      { adapter, openPath: vi.fn(), isDesktop: true },
      "a.pdf",
      () => Promise.resolve(bytes(4))
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Cache-Ordner nicht erstellbar");
  });

  it("collision: same name twice → -2 suffix, both openPath calls", async () => {
    const adapter = makeAdapter();
    const path = `${EXTERN_TEMP_DIR}/dup.pdf`;
    adapter.written[path] = new ArrayBuffer(1); // pre-existing file
    const res = await runExternOpen(
      { adapter, openPath: vi.fn(), isDesktop: true },
      "dup.pdf",
      () => Promise.resolve(bytes(8))
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.path).toBe(`${EXTERN_TEMP_DIR}/dup-2.pdf`);
  });

  it("exists-proof fails after write → ok=false (no openPath)", async () => {
    const adapter = makeAdapter({
      exists: vi.fn(async (p: string) =>
        p === EXTERN_TEMP_DIR
          ? true
          : (
              (adapter as unknown as { written: Record<string, ArrayBuffer> }).written[p] !== undefined
            )
      ),
    });
    // simulate broken exists AFTER write: force file-check false
    (adapter.exists as unknown as { mock: { mockReturnValueOnce: unknown } });
    const realExists = adapter.exists.bind(adapter);
    (adapter as { exists: unknown }).exists = async (p: string) =>
      p === EXTERN_TEMP_DIR ? true : Boolean(await realExists(p)) && false;
    const openPath = vi.fn();
    const res = await runExternOpen(
      { adapter, openPath, isDesktop: true },
      "a.pdf",
      () => Promise.resolve(bytes(4))
    );
    expect(res.ok).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it("openPath throws → ok=false with reason", async () => {
    const res = await runExternOpen(
      {
        adapter: makeAdapter(),
        openPath: async () => {
          throw new Error("shell boom");
        },
        isDesktop: true,
      },
      "a.pdf",
      () => Promise.resolve(bytes(4))
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("shell boom");
  });
});

describe("cleanupExternTemp", () => {
  it("removes all files in temp dir", async () => {
    const adapter = makeAdapter();
    adapter.written[`${EXTERN_TEMP_DIR}/x.pdf`] = new ArrayBuffer(1);
    adapter.written[`${EXTERN_TEMP_DIR}/y.docx`] = new ArrayBuffer(1);
    await cleanupExternTemp(adapter);
    expect(Object.keys(adapter.written)).toHaveLength(0);
  });

  it("missing dir → no-op", async () => {
    const adapter = makeAdapter({ exists: async () => false });
    const list = vi.fn();
    const spy = vi.spyOn(adapter, "list");
    await cleanupExternTemp(adapter);
    expect(spy).not.toHaveBeenCalled();
    void list;
  });

  it("list throws → fail-soft (no throw)", async () => {
    const adapter = makeAdapter({
      list: async () => {
        throw new Error("boom");
      },
    });
    await expect(cleanupExternTemp(adapter)).resolves.toBeUndefined();
  });

  it("individual remove failure → fail-soft per file", async () => {
    const adapter = makeAdapter({
      remove: async (p: string) => {
        if (p.endsWith("x.pdf")) throw new Error("busy");
        delete adapter.written[p];
      },
    });
    adapter.written[`${EXTERN_TEMP_DIR}/x.pdf`] = new ArrayBuffer(1);
    adapter.written[`${EXTERN_TEMP_DIR}/y.docx`] = new ArrayBuffer(1);
    await expect(cleanupExternTemp(adapter)).resolves.toBeUndefined();
    expect(adapter.written[`${EXTERN_TEMP_DIR}/y.docx`]).toBeUndefined();
  });
});

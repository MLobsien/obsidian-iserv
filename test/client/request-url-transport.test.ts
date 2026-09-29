import { describe, it, expect, vi } from "vitest";
import {
  RequestUrlTransport,
  makeRequestUrlTransport,
} from "../../src/client/RequestUrlTransport";

/**
 * RequestUrlTransport-Vertrag (Issue #4, 29.09.2026): mobile-Transport über
 * obsidian requestUrl (CORS-frei, Main-Process). Live-Beweise siehe Dateikopf
 * des Transports: fetch ist am echten Obsidian CORS-bedingt tot (IServ sendet
 * keine CORS-Header), requestUrl lebt (users/me 200 mit Cookie-Zeile).
 *
 * Diese Tests verifizieren den Vertrag mit einer mock requestUrl (echte
 * Live-Verifikation am echten IServ erfolgt separat, obsidian-cli eval).
 */

/** Mock-Response wie obsidian requestUrl liefert (status/headers/text/arrayBuffer). */
function mockResponse(
  status: number,
  headers: Record<string, string>,
  text: string,
  bytes?: Uint8Array
): {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
} {
  const ab = bytes
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new TextEncoder().encode(text).buffer;
  return {
    status,
    headers,
    arrayBuffer: ab as ArrayBuffer,
    json: null,
    text,
  };
}

describe("RequestUrlTransport (Transport-Vertrag, mobile)", () => {
  it("request() gibt status/headers/body als IServResponse zurück (throw:false — 4xx/5xx kein Throw)", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const requestUrl = vi.fn(async (param: Record<string, unknown>) => {
      calls.push(param);
      return mockResponse(401, {}, "Authentication required.");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).obsidian = { requestUrl };
    try {
      const t = new RequestUrlTransport({ hostname: "gymmeck.de" });
      const res = await t.request({
        method: "GET",
        path: "/iserv/dieschulapp/api/1.0/users/me",
        headers: { Cookie: "IServSession=x" },
      });
      expect(res.status).toBe(401);
      expect(res.body).toBe("Authentication required.");
      expect(calls[0].throw).toBe(false);
      expect(calls[0].url).toBe("https://gymmeck.de/iserv/dieschulapp/api/1.0/users/me");
      expect((calls[0].headers as Record<string, string>).Cookie).toBe("IServSession=x");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).obsidian;
    }
  });

  it("set-cookie mehrwertig (Array) wird in headers['set-cookie'] unverändert durchgereicht", async () => {
    const requestUrl = vi.fn(async () =>
      mockResponse(
        200,
        // requestUrl liefert live ein Array (bewiesen am echten IServ):
        { "set-cookie": ["IServSession=abc", "DSASESSID=def"] } as unknown as Record<string, string>,
        "{}"
      )
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).obsidian = { requestUrl };
    try {
      const t = new RequestUrlTransport({ hostname: "gymmeck.de" });
      const res = await t.request({ method: "GET", path: "/x", headers: {} });
      expect(res.headers["set-cookie"]).toEqual(["IServSession=abc", "DSASESSID=def"]);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).obsidian;
    }
  });

  it("set-cookie als EIN joined String wird an Cookie-Grenzen gesplittet (Fallback-Heuristik)", async () => {
    const requestUrl = vi.fn(async () =>
      mockResponse(
        200,
        { "set-cookie": "IServSession=abc; Path=/iserv; HttpOnly, DSASESSID=def; Path=/" } as Record<string, string>,
        "{}"
      )
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).obsidian = { requestUrl };
    try {
      const t = new RequestUrlTransport({ hostname: "gymmeck.de" });
      const res = await t.request({ method: "GET", path: "/x", headers: {} });
      const sc = res.headers["set-cookie"] as string[];
      expect(Array.isArray(sc)).toBe(true);
      expect(sc.length).toBe(2);
      expect(sc[0].startsWith("IServSession=abc")).toBe(true);
      expect(sc[1].startsWith("DSASESSID=def")).toBe(true);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).obsidian;
    }
  });

  it("bytes() liefert Rohbytes 1:1 (ArrayBuffer-Pfad, kein Text-Detour)", async () => {
    const raw = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xfc, 0x00, 0xff]);
    const requestUrl = vi.fn(async () =>
      mockResponse(200, {}, "", raw)
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).obsidian = { requestUrl };
    try {
      const t = new RequestUrlTransport({ hostname: "gymmeck.de" });
      const res = await t.bytes({ method: "GET", path: "/iserv/file/-/x.pdf", headers: {} });
      expect(Array.from(res.body)).toEqual(Array.from(raw));
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).obsidian;
    }
  });

  it("baseUrl aus cfg: port!=default kommt in die URL, ssl:false → http", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const requestUrl = vi.fn(async (param: Record<string, unknown>) => {
      calls.push(param);
      return mockResponse(200, {}, "");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).obsidian = { requestUrl };
    try {
      const t1 = new RequestUrlTransport({ hostname: "h.example", port: 8443 });
      await t1.request({ method: "GET", path: "/p", headers: {} });
      const t2 = new RequestUrlTransport({ hostname: "h.example", ssl: false, port: 8080 });
      await t2.request({ method: "GET", path: "/p", headers: {} });
      expect(calls[0].url).toBe("https://h.example:8443/p");
      expect(calls[1].url).toBe("http://h.example:8080/p");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).obsidian;
    }
  });

  it("onHopLog wird vor/nach dem Call informiert (Diagnose-Vertrag wie FetchTransport)", async () => {
    const requestUrl = vi.fn(async () => mockResponse(200, {}, "ok"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).obsidian = { requestUrl };
    try {
      const t = new RequestUrlTransport({ hostname: "gymmeck.de" });
      const notes: string[] = [];
      t.onHopLog = (m) => notes.push(m);
      await t.request({ method: "GET", path: "/x", headers: {} });
      expect(notes.length).toBeGreaterThanOrEqual(2);
      expect(notes[0]).toContain("GET /x");
      expect(notes[notes.length - 1]).toContain("FINAL");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).obsidian;
    }
  });

  it("makeRequestUrlTransport liefert eine Instanz (Factory für main.ts)", () => {
    const t = makeRequestUrlTransport({ hostname: "gymmeck.de" });
    expect(t).toBeInstanceOf(RequestUrlTransport);
  });
});

describe("CookieStore.parseCookieHeader (mobile Session-Weitergabe)", async () => {
  const { CookieStore } = await import("../../src/client/CookieStore");

  it("importiert eine komplette Cookie-Zeile (alle Paare)", () => {
    const store = new CookieStore();
    store.parseCookieHeader("IServAuthSession=a; IServAuthSID=b; IServSession=c; IServSAT=d; IServSATId=e; DSASESSID=f");
    expect(store.get("IServSession")).toBe("c");
    expect(store.get("DSASESSID")).toBe("f");
    expect(store.get("IServSATId")).toBe("e");
    const out = store.toHeader();
    expect(out).toContain("IServSession=c");
    expect(out).toContain("DSASESSID=f");
  });

  it("leere/defekte Teile werfen nicht (robust gegen transportierte Zeilen)", () => {
    const store = new CookieStore();
    store.parseCookieHeader("a=1;; b=2; not-a-pair");
    expect(store.get("a")).toBe("1");
    expect(store.get("b")).toBe("2");
  });
});

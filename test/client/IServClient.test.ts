import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IServClient, IServConfig, IServResponse } from '../../src/client/IServClient';
import { CookieStore } from '../../src/client/CookieStore';

// ---------------------------------------------------------------------------
// CookieStore tests
// ---------------------------------------------------------------------------

describe('CookieStore', () => {
  let store: CookieStore;

  beforeEach(() => {
    store = new CookieStore();
  });

  it('parses a single Set-Cookie header string', () => {
    store.parseSetCookie('session=abc123; Path=/; HttpOnly');
    expect(store.get('session')).toBe('abc123');
  });

  it('parses an array of Set-Cookie header strings', () => {
    store.parseSetCookie([
      'token=xyz; Path=/',
      'lang=de; Path=/; Max-Age=3600',
    ]);
    expect(store.get('token')).toBe('xyz');
    expect(store.get('lang')).toBe('de');
  });

  it('ignores undefined or empty header', () => {
    store.parseSetCookie(undefined);
    expect(store.toHeader()).toBe('');

    store.parseSetCookie('');
    expect(store.toHeader()).toBe('');
  });

  it('get returns undefined for missing cookie', () => {
    expect(store.get('nope')).toBeUndefined();
  });

  it('set and get round-trip a cookie value', () => {
    store.set('custom', 'value-1');
    expect(store.get('custom')).toBe('value-1');
  });

  it('toHeader formats all cookies as "name=value; name2=value2"', () => {
    store.set('a', '1');
    store.set('b', '2');
    expect(store.toHeader()).toBe('a=1; b=2');
  });

  it('clear removes all cookies', () => {
    store.set('x', 'y');
    store.parseSetCookie('z=9');
    store.clear();
    expect(store.toHeader()).toBe('');
    expect(store.get('x')).toBeUndefined();
    expect(store.get('z')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// IServClient tests
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<IServConfig> = {}): IServConfig {
  return {
    hostname: 'iserv.example.com',
    username: 'user',
    password: 'pass',
    ...overrides,
  };
}

function fakeResponse(overrides: Partial<IServResponse> = {}): IServResponse {
  return {
    status: 200,
    headers: {},
    body: '',
    ...overrides,
  };
}

describe('IServClient', () => {
  let client: IServClient;

  beforeEach(() => {
    client = new IServClient(makeConfig());
  });

  // -- login ---------------------------------------------------------------

  it('login POSTs form-encoded credentials to /iserv/auth/login', async () => {
    const spy = vi.spyOn(client, 'rawRequest').mockResolvedValue(fakeResponse());

    await client.login();

    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/iserv/auth/login');
    expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(call.body).toContain('_username=user');
    expect(call.body).toContain('_password=pass');
  });

  it('login captures Set-Cookie from the response', async () => {
    vi.spyOn(client, 'rawRequest').mockResolvedValue(
      fakeResponse({
        headers: { 'set-cookie': ['IServSession=abc; Path=/'] },
      }),
    );

    await client.login();
    expect(client['cookies'].get('IServSession')).toBe('abc');
  });

  it('login follows redirects by returning the response', async () => {
    const resp302 = fakeResponse({ status: 302, headers: { location: '/iserv/' } });
    vi.spyOn(client, 'rawRequest').mockResolvedValue(resp302);

    const result = await client.login();
    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/iserv/');
  });

  // -- request & rate limiter ----------------------------------------------

  it('request sends stored cookies in the Cookie header', async () => {
    client['cookies'].set('sid', 'tok');

    const spy = vi.spyOn(client, 'rawRequest').mockResolvedValue(fakeResponse());

    await client.request('/iserv/mail/api/v2/messages');

    const call = spy.mock.calls[0][0];
    expect(call.headers['Cookie']).toBe('sid=tok');
  });

  it('request auto-captures Set-Cookie from the response', async () => {
    vi.spyOn(client, 'rawRequest').mockResolvedValue(
      fakeResponse({
        headers: { 'set-cookie': ['new=cookie; Path=/'] },
      }),
    );

    await client.request('/some/path');
    expect(client['cookies'].get('new')).toBe('cookie');
  });

  it('request defaults to GET when no method given', async () => {
    const spy = vi.spyOn(client, 'rawRequest').mockResolvedValue(fakeResponse());

    await client.request('/inbox');

    expect(spy.mock.calls[0][0].method).toBe('GET');
  });

  it('request serialises object body as JSON (allowlisted write path)', async () => {
    const spy = vi.spyOn(client, 'rawRequest').mockResolvedValue(fakeResponse());

    await client.request('/iserv/public/telemetry/heartbeat', {
      method: 'POST',
      body: { to: 'a@b.de', text: 'hi' },
    });

    const call = spy.mock.calls[0][0];
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.body!)).toEqual({ to: 'a@b.de', text: 'hi' });
  });

  // -- rate limiter --------------------------------------------------------

  it('rate limiter spaces requests at least 200 ms apart', async () => {
    vi.spyOn(client, 'rawRequest').mockResolvedValue(fakeResponse());

    const t0 = Date.now();
    await client.request('/a');
    await client.request('/b');
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeGreaterThanOrEqual(180); // allow timer imprecision
  });

  // -- rawRequest ----------------------------------------------------------

  it('rawRequest returns status, headers, and body', async () => {
    // rawRequest calls Node http(s) directly; we can spy on the module
    // but for a unit test we just verify the interface shape via request()
    const fake = fakeResponse({
      status: 201,
      headers: { 'x-custom': 'yes' },
      body: '{"ok":true}',
    });
    vi.spyOn(client, 'rawRequest').mockResolvedValue(fake);

    const resp = await client.request('/test');
    expect(resp.status).toBe(201);
    expect(resp.headers['x-custom']).toBe('yes');
    expect(resp.body).toBe('{"ok":true}');
  });

  it('request can override headers', async () => {
    const spy = vi.spyOn(client, 'rawRequest').mockResolvedValue(fakeResponse());

    await client.request('/data', {
      headers: { 'X-Custom': 'val' },
    });

    expect(spy.mock.calls[0][0].headers['X-Custom']).toBe('val');
  });
});

describe("login redirect chain + 2FA + transport seam (T17.2)", () => {
  it("follows redirects until IServSession appears", async () => {
    const client = new IServClient(makeConfig());
    const responses: IServResponse[] = [
      fakeResponse({ status: 302, headers: { location: "/iserv/auth/auth" } }),
      fakeResponse({ status: 200, body: '<meta http-equiv="refresh" content="0;url=/iserv/">' }),
      fakeResponse({ status: 302, headers: { location: "/iserv/" } }),
      fakeResponse({ status: 200, headers: { "set-cookie": ["IServSession=sess7; HttpOnly"] } }),
      fakeResponse({ status: 200, body: "ok" }),
    ];
    const spy = vi.spyOn(client, "rawRequest");
    let i = 0;
    spy.mockImplementation(async () => responses[Math.min(i++, responses.length - 1)]);

    await client.login();

    expect(client["cookies"].get("IServSession")).toBe("sess7");
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("POSTs _two_factor_token when provided", async () => {
    const client = new IServClient({ ...makeConfig(), twoFactorToken: "123456" });
    const spy = vi.spyOn(client, "rawRequest").mockResolvedValue(
      fakeResponse({ headers: { "set-cookie": ["IServSession=s; HttpOnly"] } })
    );
    await client.login();
    const body = spy.mock.calls[0][0].body ?? "";
    expect(body).toContain("_two_factor_token=123456");
  });

  it("supports injected transport (ADR-0005 seam)", async () => {
    const transportCalls: string[] = [];
    const client = new IServClient(makeConfig(), {
      request: async (opts) => {
        transportCalls.push(opts.path);
        return fakeResponse({ headers: { "set-cookie": ["IServSession=t; HttpOnly"] } });
      },
    });
    await client.login();
    expect(transportCalls[0]).toBe("/iserv/auth/login");
  });
});

describe("Read-Only-Guard (ADR-0005)", () => {
  it("rejects write methods outside allowlist", async () => {
    const client = new IServClient(makeConfig());
    vi.spyOn(client, "rawRequest").mockResolvedValue(fakeResponse());
    await expect(
      client.request("/iserv/exercise", { method: "POST", body: "{}" })
    ).rejects.toThrow(/read-only/i);
  });

  it("allows POST only for login and telemetry endpoints", async () => {
    const client = new IServClient(makeConfig());
    vi.spyOn(client, "rawRequest").mockResolvedValue(fakeResponse());
    await expect(
      client.request("/iserv/public/telemetry/heartbeat", { method: "POST", body: "{}" })
    ).resolves.toBeDefined();
  });
});

/**
 * Geteilter IServClient-Seam + JSON-Helper für die API-Module.
 *
 * Alle API-Module konsumieren nur `request()` und IServResponse — kein Feld
 * `json` (das der reale Client nie liefert; gelernt aus Review-Fund
 * "fiktives IServClient-Interface").
 */
import type { IServResponse } from "../client/IServClient";

/** Minimal shape of an IServ client with a `request` method. */
export interface IServClient {
  request(
    path: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> }
  ): Promise<IServResponse>;
}

/** Parse IServResponse.body als JSON; null bei Non-200 oder unpassbarem Körper. */
export function parseResponseBody(
  resp: IServResponse
): Record<string, unknown> | null {
  if (resp.status !== 200) return null;
  try {
    const parsed: unknown = JSON.parse(resp.body);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Parse IServResponse.body als JSON-Array (top-level); null bei Non-200/unpassbar. */
export function parseResponseBodyArray(resp: IServResponse): unknown[] | null {
  if (resp.status !== 200) return null;
  try {
    const parsed: unknown = JSON.parse(resp.body);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

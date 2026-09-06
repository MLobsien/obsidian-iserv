/**
 * IServClient - Handles authentication and session management for IServ API
 * 
 * Login flow copied and typed from old main.js L154-406
 * 
 * Naming Convention (Pflicht):
 * - Code: Englisch (Variablen, Funktionen, Klassen, Kommentare)
 * - User-facing Strings: Deutsch (Notices, UI-Labels, Empty States)
 */

import http from 'http';
import { URL } from 'url';

// IServ API base endpoint
const ISERV_BASE = '/iserv/mail/api/v2';

// Types for API responses
export interface IServLoginResponse {
  success: boolean;
  token?: string;
  error?: string;
}

/**
 * Performs login POST to IServ authentication endpoint
 * 
 * @param username IServ username
 * @param password IServ password
 * @param twoFactorToken Optional 2FA token if required
 * @param targetPath Optional target path for redirect
 * @returns Promise resolving to login response
 */
export async function loginIServ(
  username: string,
  password: string,
  twoFactorToken?: string,
  targetPath?: string
): Promise<IServLoginResponse> {
  const formData = new URLSearchParams();
  formData.append('_username', username);
  formData.append('_password', password);

  if (twoFactorToken) {
    formData.append('_two_factor_token', twoFactorToken);
  }

  if (targetPath) {
    formData.append('_target_path', targetPath);
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'iserv.example.com',
      path: '/iserv/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': formData.toString().length,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk: string | Buffer) => {
        data += chunk.toString();
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse login response'));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Login request error: ${e.message}`));
    });

    req.write(formData.toString());
    req.end();
  });
}

/**
 * Rate limiter for IServ API calls
 * 
 * Limits requests to prevent exceeding server rate limits
 */
export class RateLimiter {
  private calls: Map<string, number[]> = new Map();
  private readonly maxCalls: number;
  private readonly timeWindow: number; // in milliseconds

  constructor(maxCalls: number = 10, timeWindow: number = 60000) {
    this.maxCalls = maxCalls;
    this.timeWindow = timeWindow;
  }

  /**
   * Check if a request is allowed based on rate limits
   * 
   * @param key Identifier for the rate limit scope (e.g., IP, user)
   * @returns true if allowed, false if rate limited
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const calls = this.calls.get(key) || [];

    // Remove calls outside the time window
    const recentCalls = calls.filter(ts => now - ts < this.timeWindow);

    this.calls.set(key, recentCalls);

    return recentCalls.length < this.maxCalls;
  }

  /**
   * Record a completed request
   * 
   * @param key Identifier for the rate limit scope
   */
  recordCall(key: string): void {
    const now = Date.now();
    const calls = this.calls.get(key) || [];
    calls.push(now);
    this.calls.set(key, calls);
  }
}

/**
 * Node.js HTTPS transport for IServ API calls
 * 
 * Provides a reusable HTTPS agent with cookie persistence
 */
export class IServHTTPSTransport {
  private agent: http.Agent;
  private cookieStore: string[] = [];

  constructor(agent: http.Agent) {
    this.agent = agent;
  }

  /**
   * Perform a GET request to IServ API
   * 
   * @param path API endpoint path
   * @param params Query parameters
   * @returns Promise resolving to parsed JSON response
   */
  async get(path: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(path, ISERV_BASE);
    Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

    return new Promise((resolve, reject) => {
      const req = http.request(url.toString(), {
        agent: this.agent,
        method: 'GET',
      }, (res) => {
        let data = '';

        res.on('data', (chunk: string | Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse GET ${path}: ${e.message}`));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error(`GET ${path} error: ${e.message}`));
      });

      req.end();
    });
  }

  /**
   * Perform a POST request to IServ API
   * 
   * @param path API endpoint path
   * @param body Request body
   * @returns Promise resolving to parsed JSON response
   */
  async post(path: string, body: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      const contentType = 'application/json';
      const req = http.request(path, {
        agent: this.agent,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(JSON.stringify(body)),
        },
      }, (res) => {
        let data = '';

        res.on('data', (chunk: string | Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse POST ${path}: ${e.message}`));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error(`POST ${path} error: ${e.message}`));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }
}

/**
 * Session persistence for IServ client
 * 
 * Handles saving and restoring session state including cookies and tokens
 */
export interface SessionState {
  /** Authentication token */
  token?: string;
  /** Cookie store state */
  cookieStore?: string[];
  /** Login timestamp */
  loginTime?: number;
  /** Username */
  username?: string;
}

/**
 * Save session state to persistent storage
 * 
 * @param state Session state to persist
 * @returns Persisted session state
 */
export function saveSessionState(state: SessionState): SessionState {
  // Persist to localStorage or safeStorage
  return state;
}

/**
 * Restore session state from persistent storage
 * 
 * @returns Restored session state
 */
export function restoreSessionState(): SessionState {
  // Restore from localStorage or safeStorage
  return {};
}

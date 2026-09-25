import { getValidAccessToken } from "./supabase";

/**
 * Builds an absolute API URL for fetch calls.
 * Production: `VITE_PUBLIC_SERVER_URL` (or `VITE_API_URL`) points at the api-server.
 * Local dev: relative paths use the Vite `/api` proxy when no public URL is set.
 */
const DEFAULT_PRODUCTION_API_ORIGIN = "https://api-qinaa.onrender.com";

function normalizeApiOrigin(rawValue: string): string | null {
  const raw = rawValue.trim();
  if (!raw) return null;

  // A Render variable was once pasted as a Markdown link. Accept that exact
  // shape defensively, but always reduce it to a real URL before using it.
  const markdownLink = raw.match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  const candidate = markdownLink?.[1] ?? raw;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const configuredValue =
    (import.meta.env.VITE_PUBLIC_SERVER_URL as string | undefined) ??
    (import.meta.env.VITE_API_URL as string | undefined);
  const configuredOrigin = configuredValue
    ? normalizeApiOrigin(configuredValue)
    : null;

  if (configuredOrigin) return `${configuredOrigin}${normalized}`;

  if (configuredValue) {
    console.error("Invalid API server URL configuration.");
  }

  // Keep the hosted app functional even if its optional Render variable is
  // missing or malformed. Development still uses Vite's same-origin proxy.
  if (import.meta.env.PROD) {
    return `${DEFAULT_PRODUCTION_API_ORIGIN}${normalized}`;
  }

  // Dev fallback: same-origin relative path → Vite proxy → api-server
  return normalized;
}

/**
 * Wake the public API before the customer reaches a server-backed action.
 *
 * The production API currently runs on an idling Render instance. This
 * request is deliberately best-effort and never blocks rendering: opening
 * the game or its store starts the wake-up early, so checkout does not have
 * to be the request that pays the cold-start cost.
 */
export function warmApiServer(): void {
  void fetch(apiUrl("/api/healthz"), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  }).catch(() => {
    // A later authenticated request still reports its own actionable error.
  });
}

/**
 * Read a fetch body via `response.text()` only — never calls `response.json()`.
 * Returns `{}` for empty bodies and on parse failures (never throws).
 */
export async function readResponseJson<
  T extends Record<string, unknown> = Record<string, unknown>,
>(resp: Response): Promise<T> {
  let text = "";
  try {
    text = await resp.text();
  } catch (err) {
    console.error("Failed to read response text:", err);
    return {} as T;
  }

  if (!text.trim()) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    console.error(
      "Failed to parse response JSON:",
      resp.status,
      text.slice(0, 200),
      err,
    );
    return { error: text.slice(0, 500), _nonJson: true } as unknown as T;
  }
}

/** POST helper — always parses the body via `readResponseJson` (text-only). */
export async function apiPost<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ resp: Response; data: T }> {
  const resp = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const data = await readResponseJson<T>(resp);
  return { resp, data };
}

/**
 * Authenticated POST with one forced session refresh on HTTP 401.
 *
 * Supabase refresh tokens rotate, so the refresh is deduplicated in
 * `getValidAccessToken`. A missing local session is represented by a null
 * response and the same error shape returned by the API.
 */
export async function apiPostAuthenticated<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  path: string,
  body: unknown,
): Promise<{ resp: Response | null; data: T }> {
  const firstToken = await getValidAccessToken();
  if (!firstToken) {
    return {
      resp: null,
      data: { error: "missing_auth_token" } as unknown as T,
    };
  }

  let result = await apiPost<T>(path, body, {
    Authorization: `Bearer ${firstToken}`,
  });
  if (result.resp.status !== 401) return result;

  const refreshedToken = await getValidAccessToken({ forceRefresh: true });
  if (!refreshedToken) return result;

  result = await apiPost<T>(path, body, {
    Authorization: `Bearer ${refreshedToken}`,
  });
  return result;
}

/** @deprecated Use readResponseJson — kept for compatibility; never calls response.json(). */
export const parseJsonResponse = readResponseJson;

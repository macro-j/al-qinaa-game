/** Default api-server origin for local development. */
const DEFAULT_API_BASE = "http://localhost:3000";

/**
 * Builds an absolute API URL for fetch calls.
 * Uses `VITE_API_URL` when set; otherwise hits the api-server directly at
 * `http://localhost:3000` (no Vite proxy required).
 */
export function apiUrl(path: string): string {
  const base =
    (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ??
    DEFAULT_API_BASE;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
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
    return { error: text.slice(0, 500), _nonJson: true } as T;
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

/** @deprecated Use readResponseJson — kept for compatibility; never calls response.json(). */
export const parseJsonResponse = readResponseJson;

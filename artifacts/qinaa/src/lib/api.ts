/**
 * Builds an absolute API URL for fetch calls.
 * Production: `VITE_PUBLIC_SERVER_URL` (or `VITE_API_URL`) points at the api-server.
 * Local dev: relative paths use the Vite `/api` proxy when no public URL is set.
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const publicServer = (
    import.meta.env.VITE_PUBLIC_SERVER_URL as string | undefined
  )?.replace(/\/+$/, "");
  if (publicServer) return `${publicServer}${normalized}`;

  const viteApi = (import.meta.env.VITE_API_URL as string | undefined)?.replace(
    /\/+$/,
    "",
  );
  if (viteApi) return `${viteApi}${normalized}`;

  // Dev fallback: same-origin relative path → Vite proxy → api-server
  return normalized;
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

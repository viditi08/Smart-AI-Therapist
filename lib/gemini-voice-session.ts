/**
 * Client/server contract for Gemini Live voice bootstrap.
 * @see POST /api/gemini/live-token
 */

export interface GeminiLiveHttpOptions {
  /** Gemini API version for Live + auth token flows (e.g. v1alpha). */
  apiVersion: string;
}

/**
 * Successful JSON body from `POST /api/gemini/live-token`.
 * `apiKey` is the **ephemeral** Live session credential (often `auth_tokens/...`), not your AI Studio key.
 */
export interface GeminiLiveTokenResponse {
  apiKey: string;
  model: string;
  httpOptions: GeminiLiveHttpOptions;
  /**
   * Exact `LiveConnectConfig` used when minting the ephemeral token.
   * Pass this verbatim to `ai.live.connect({ config })` so the WebSocket setup matches constraints (avoids immediate server close).
   */
  connectConfig?: Record<string, unknown>;
}

/** Error JSON from the same route when `res.ok` is false. */
export interface GeminiLiveTokenErrorBody {
  error: string;
}

export function isGeminiLiveTokenResponse(
  value: unknown,
): value is GeminiLiveTokenResponse {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  const http = o.httpOptions;
  if (http === null || typeof http !== "object") return false;
  const h = http as Record<string, unknown>;
  return (
    typeof o.apiKey === "string" &&
    o.apiKey.length > 0 &&
    typeof o.model === "string" &&
    o.model.length > 0 &&
    typeof h.apiVersion === "string" &&
    h.apiVersion.length > 0 &&
    (o.connectConfig === undefined ||
      (typeof o.connectConfig === "object" && o.connectConfig !== null))
  );
}

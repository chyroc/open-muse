export interface Env {
  DB: D1Database;
  OWNER_ID: string;
  // JSON object mapping SHA-256 device-token hashes to non-secret device labels.
  DEVICE_TOKEN_HASHES?: string;
  ALLOWED_ORIGINS?: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

import { timingSafeEqual } from "node:crypto";

export function requireWriteToken(request: Request) {
  const expected = process.env.OPTION_DATA_WRITE_TOKEN;
  if (!expected) {
    return { ok: false as const, status: 503, message: "OPTION_DATA_WRITE_TOKEN is not configured" };
  }

  const headerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    || request.headers.get("x-option-data-token")?.trim()
    || "";

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(headerToken);
  const matches = expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);

  if (!matches) return { ok: false as const, status: 401, message: "unauthorized" };
  return { ok: true as const };
}

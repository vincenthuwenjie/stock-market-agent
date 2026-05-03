import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { latestOptionBlobPath, optionBlobPathForDate } from "@/lib/option-blob";
import { requireWriteToken } from "@/lib/write-auth";

export const dynamic = "force-dynamic";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ALLOWED_BYTES = 20 * 1024 * 1024;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const CACHE_SECONDS = 300;

function normalizeDate(value: unknown) {
  if (value === undefined || value === null || value === "") return new Date().toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new Error("date must use YYYY-MM-DD format");
}

function normalizeMaxBytes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(Math.round(value), MAX_ALLOWED_BYTES);
}

export async function POST(request: Request) {
  const auth = requireWriteToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ ok: false, error: "BLOB_READ_WRITE_TOKEN is not configured" }, { status: 503 });
    }

    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    const date = normalizeDate(payload.date);
    const includeLatest = payload.includeLatest !== false;
    const maximumSizeInBytes = normalizeMaxBytes(payload.maximumSizeInBytes);
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    const paths = [
      { role: "daily", pathname: optionBlobPathForDate(date) },
      ...(includeLatest ? [{ role: "latest", pathname: latestOptionBlobPath() }] : []),
    ];

    const uploads = await Promise.all(paths.map(async (item) => ({
      ...item,
      access: "private" as const,
      contentType: "application/json",
      clientToken: await generateClientTokenFromReadWriteToken({
        pathname: item.pathname,
        maximumSizeInBytes,
        validUntil: expiresAt,
        allowedContentTypes: ["application/json", "text/json", "application/octet-stream"],
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: CACHE_SECONDS,
      }),
    })));

    return NextResponse.json({
      ok: true,
      date,
      expiresAt: new Date(expiresAt).toISOString(),
      maximumSizeInBytes,
      uploads,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "failed to create upload token" }, { status: 400 });
  }
}

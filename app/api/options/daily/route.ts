import { NextResponse } from "next/server";
import { writeOptionSnapshot } from "@/lib/option-blob";
import { requireWriteToken } from "@/lib/write-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = requireWriteToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const payload = await request.json();
    const result = await writeOptionSnapshot(payload);
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to write option data";
    const status = message.includes("BLOB_READ_WRITE_TOKEN") ? 503 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { validateJobSecret, handleRunStart, handleRunFinish } from "@/lib/job-engine";

/**
 * Internal endpoint called by the job wrapper script to notify run start/finish.
 * Authenticated via a shared secret (not user session).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const secret = req.headers.get("X-Job-Secret") ?? "";
  if (!validateJobSecret(secret)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
  }

  try {
    const body = await req.json();

    if (body.event === "start") {
      const runId = handleRunStart(params.id, body.trigger ?? "timer");
      return NextResponse.json({ run_id: runId });
    }

    if (body.event === "finish") {
      await handleRunFinish(
        params.id,
        body.run_id ?? "unknown",
        body.exit_code ?? 1,
        body.duration_ms ?? 0,
        body.output ?? "",
        body.log_path ?? "",
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getJob, listJobRuns, getJobRun, isUserAdmin } from "@/lib/claude-db";
import { getRunLogContent } from "@/lib/job-engine";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isUserAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

  if (runId) {
    const run = await getJobRun(runId);
    if (!run || run.job_id !== params.id) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    const logContent = getRunLogContent(params.id, runId);
    return NextResponse.json({ run, logContent });
  }

  const runs = await listJobRuns(params.id, limit);
  return NextResponse.json({ runs });
}

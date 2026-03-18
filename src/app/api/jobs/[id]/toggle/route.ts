import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getJob, isUserAdmin } from "@/lib/claude-db";
import { enableJob, disableJob } from "@/lib/job-engine";
import { logActivity } from "@/lib/activity-log";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isUserAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const shouldEnable = job.status !== "active";
  const result = shouldEnable ? await enableJob(params.id) : await disableJob(params.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await logActivity(
    (shouldEnable ? "job_enabled" : "job_disabled") as never,
    session.user.email,
    { jobId: job.id, name: job.name },
  );

  const updated = await getJob(params.id);
  return NextResponse.json({ job: updated });
}

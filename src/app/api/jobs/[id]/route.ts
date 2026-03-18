import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getJob, updateJob, deleteJob, isUserAdmin } from "@/lib/claude-db";
import { installJob, uninstallJob } from "@/lib/job-engine";
import { logActivity } from "@/lib/activity-log";

async function checkAdmin(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await isUserAdmin(session.user.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  const existing = await getJob(params.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json();
    const job = await updateJob(params.id, body);

    const scheduleChanged = body.schedule && body.schedule !== existing.schedule;
    const scriptChanged = body.script_path && body.script_path !== existing.script_path;
    if (scheduleChanged || scriptChanged) {
      await installJob(params.id);
    }

    await logActivity("job_updated" as never, auth.email, { jobId: job.id, name: job.name });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await uninstallJob(params.id);
  await deleteJob(params.id);
  await logActivity("job_deleted" as never, auth.email, { jobId: job.id, name: job.name });
  return NextResponse.json({ ok: true });
}

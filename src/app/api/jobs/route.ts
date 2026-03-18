import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listJobs, createJob, isUserAdmin } from "@/lib/claude-db";
import { installJob } from "@/lib/job-engine";
import { logActivity } from "@/lib/activity-log";

async function checkAdmin(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await isUserAdmin(session.user.email))) {
    return { error: NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

export async function GET() {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  const jobs = await listJobs();
  return NextResponse.json({ jobs });
}

export async function POST(req: Request) {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const { name, description, script_path, schedule, schedule_display, working_directory,
      environment, max_retries, timeout_seconds, auto_disable_after,
      notify_on_failure, notify_on_success, tags, ai_generated } = body;

    if (!name || !script_path || !schedule) {
      return NextResponse.json({ error: "name, script_path, and schedule are required" }, { status: 400 });
    }

    const job = await createJob({
      name, description, script_path, schedule, schedule_display, working_directory,
      environment, max_retries, timeout_seconds, auto_disable_after,
      notify_on_failure, notify_on_success, tags, ai_generated,
    }, auth.email);

    const result = await installJob(job.id);
    if (!result.ok) {
      return NextResponse.json({ job, warning: `Job created but systemd install failed: ${result.error}` });
    }

    await logActivity("job_created" as never, auth.email, { jobId: job.id, name: job.name });

    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

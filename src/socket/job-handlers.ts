import type { HandlerContext } from "./types";
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  listJobRuns,
  getJobRun,
} from "../lib/claude-db";
import {
  installJob,
  uninstallJob,
  enableJob,
  disableJob,
  runJobNow,
  getRunLogContent,
  JOB_TEMPLATES,
} from "../lib/job-engine";
import { logActivity } from "../lib/activity-log";

export function registerJobHandlers(ctx: HandlerContext) {
  const { socket, email, isAdmin } = ctx;

  function requireAdmin(cb: () => void) {
    if (!isAdmin) {
      socket.emit("claude:error", { message: "Admin access required for Jobs" });
      return;
    }
    cb();
  }

  socket.on("claude:list_jobs", () => {
    requireAdmin(async () => {
      try {
        const jobs = await listJobs();
        socket.emit("claude:jobs", { jobs });
      } catch {
        socket.emit("claude:jobs", { jobs: [] });
      }
    });
  });

  socket.on("claude:create_job", (data: {
    name: string;
    description?: string;
    script_path: string;
    schedule: string;
    schedule_display?: string;
    working_directory?: string;
    environment?: Record<string, string>;
    max_retries?: number;
    timeout_seconds?: number;
    auto_disable_after?: number;
    notify_on_failure?: boolean;
    notify_on_success?: boolean;
    tags?: string[];
    ai_generated?: boolean;
  }) => {
    requireAdmin(async () => {
      try {
        if (!data.name || !data.script_path || !data.schedule) {
          socket.emit("claude:error", { message: "name, script_path, and schedule are required" });
          return;
        }
        const job = await createJob(data, email);
        const installResult = await installJob(job.id);
        if (!installResult.ok) {
          socket.emit("claude:job_warning", {
            jobId: job.id,
            message: `Job created but systemd install failed: ${installResult.error}`,
          });
        }
        await logActivity("job_created", email, { jobId: job.id, name: job.name });
        socket.emit("claude:job_created", { job });
        socket.emit("claude:jobs", { jobs: await listJobs() });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:update_job", ({ jobId, data }: {
    jobId: string;
    data: Record<string, unknown>;
  }) => {
    requireAdmin(async () => {
      try {
        const existing = await getJob(jobId);
        if (!existing) {
          socket.emit("claude:error", { message: "Job not found" });
          return;
        }
        const job = await updateJob(jobId, data as Parameters<typeof updateJob>[1]);
        const scheduleChanged = data.schedule && data.schedule !== existing.schedule;
        const scriptChanged = data.script_path && data.script_path !== existing.script_path;
        if (scheduleChanged || scriptChanged) {
          await installJob(jobId);
        }
        await logActivity("job_updated", email, { jobId: job.id, name: job.name });
        socket.emit("claude:job_updated", { job });
        socket.emit("claude:jobs", { jobs: await listJobs() });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:delete_job", ({ jobId }: { jobId: string }) => {
    requireAdmin(async () => {
      try {
        const job = await getJob(jobId);
        if (!job) {
          socket.emit("claude:error", { message: "Job not found" });
          return;
        }
        uninstallJob(jobId);
        await deleteJob(jobId);
        await logActivity("job_deleted", email, { jobId: job.id, name: job.name });
        socket.emit("claude:job_deleted", { jobId });
        socket.emit("claude:jobs", { jobs: await listJobs() });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:toggle_job", ({ jobId }: { jobId: string }) => {
    requireAdmin(async () => {
      try {
        const job = await getJob(jobId);
        if (!job) {
          socket.emit("claude:error", { message: "Job not found" });
          return;
        }
        const shouldEnable = job.status !== "active";
        const result = shouldEnable ? await enableJob(jobId) : await disableJob(jobId);
        if (!result.ok) {
          socket.emit("claude:error", { message: result.error ?? "Toggle failed" });
          return;
        }
        await logActivity(
          shouldEnable ? "job_enabled" : "job_disabled",
          email,
          { jobId: job.id, name: job.name },
        );
        const updated = await getJob(jobId);
        socket.emit("claude:job_updated", { job: updated });
        socket.emit("claude:jobs", { jobs: await listJobs() });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:run_job_now", ({ jobId }: { jobId: string }) => {
    requireAdmin(async () => {
      try {
        const result = await runJobNow(jobId, email);
        if (!result.ok) {
          socket.emit("claude:error", { message: result.error ?? "Run failed" });
          return;
        }
        socket.emit("claude:job_run_started", { jobId, runId: result.runId });
        setTimeout(async () => {
          socket.emit("claude:jobs", { jobs: await listJobs() });
        }, 2000);
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:get_job_runs", ({ jobId, limit }: { jobId: string; limit?: number }) => {
    requireAdmin(async () => {
      try {
        const runs = await listJobRuns(jobId, limit ?? 50);
        socket.emit("claude:job_runs", { jobId, runs });
      } catch {
        socket.emit("claude:job_runs", { jobId, runs: [] });
      }
    });
  });

  socket.on("claude:get_job_run_log", ({ jobId, runId }: { jobId: string; runId: string }) => {
    requireAdmin(async () => {
      try {
        const run = await getJobRun(runId);
        if (!run || run.job_id !== jobId) {
          socket.emit("claude:error", { message: "Run not found" });
          return;
        }
        const logContent = getRunLogContent(jobId, runId);
        socket.emit("claude:job_run_log", { jobId, runId, logContent, run });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:get_job_templates", () => {
    requireAdmin(() => {
      socket.emit("claude:job_templates", { templates: JOB_TEMPLATES });
    });
  });
}

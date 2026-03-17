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
    requireAdmin(() => {
      try {
        const jobs = listJobs();
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
    requireAdmin(() => {
      try {
        if (!data.name || !data.script_path || !data.schedule) {
          socket.emit("claude:error", { message: "name, script_path, and schedule are required" });
          return;
        }
        const job = createJob(data, email);
        const result = installJob(job.id);
        if (!result.ok) {
          socket.emit("claude:job_warning", {
            jobId: job.id,
            message: `Job created but systemd install failed: ${result.error}`,
          });
        }
        logActivity("job_created", email, { jobId: job.id, name: job.name });
        socket.emit("claude:job_created", { job });
        socket.emit("claude:jobs", { jobs: listJobs() });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:update_job", ({ jobId, data }: {
    jobId: string;
    data: Record<string, unknown>;
  }) => {
    requireAdmin(() => {
      try {
        const existing = getJob(jobId);
        if (!existing) {
          socket.emit("claude:error", { message: "Job not found" });
          return;
        }
        const job = updateJob(jobId, data as Parameters<typeof updateJob>[1]);
        const scheduleChanged = data.schedule && data.schedule !== existing.schedule;
        const scriptChanged = data.script_path && data.script_path !== existing.script_path;
        if (scheduleChanged || scriptChanged) {
          installJob(jobId);
        }
        logActivity("job_updated", email, { jobId: job.id, name: job.name });
        socket.emit("claude:job_updated", { job });
        socket.emit("claude:jobs", { jobs: listJobs() });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:delete_job", ({ jobId }: { jobId: string }) => {
    requireAdmin(() => {
      try {
        const job = getJob(jobId);
        if (!job) {
          socket.emit("claude:error", { message: "Job not found" });
          return;
        }
        uninstallJob(jobId);
        deleteJob(jobId);
        logActivity("job_deleted", email, { jobId: job.id, name: job.name });
        socket.emit("claude:job_deleted", { jobId });
        socket.emit("claude:jobs", { jobs: listJobs() });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:toggle_job", ({ jobId }: { jobId: string }) => {
    requireAdmin(() => {
      try {
        const job = getJob(jobId);
        if (!job) {
          socket.emit("claude:error", { message: "Job not found" });
          return;
        }
        const shouldEnable = job.status !== "active";
        const result = shouldEnable ? enableJob(jobId) : disableJob(jobId);
        if (!result.ok) {
          socket.emit("claude:error", { message: result.error ?? "Toggle failed" });
          return;
        }
        logActivity(
          shouldEnable ? "job_enabled" : "job_disabled",
          email,
          { jobId: job.id, name: job.name },
        );
        const updated = getJob(jobId);
        socket.emit("claude:job_updated", { job: updated });
        socket.emit("claude:jobs", { jobs: listJobs() });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:run_job_now", ({ jobId }: { jobId: string }) => {
    requireAdmin(() => {
      try {
        const result = runJobNow(jobId, email);
        if (!result.ok) {
          socket.emit("claude:error", { message: result.error ?? "Run failed" });
          return;
        }
        socket.emit("claude:job_run_started", { jobId, runId: result.runId });
        setTimeout(() => {
          socket.emit("claude:jobs", { jobs: listJobs() });
        }, 2000);
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });
  });

  socket.on("claude:get_job_runs", ({ jobId, limit }: { jobId: string; limit?: number }) => {
    requireAdmin(() => {
      try {
        const runs = listJobRuns(jobId, limit ?? 50);
        socket.emit("claude:job_runs", { jobId, runs });
      } catch {
        socket.emit("claude:job_runs", { jobId, runs: [] });
      }
    });
  });

  socket.on("claude:get_job_run_log", ({ jobId, runId }: { jobId: string; runId: string }) => {
    requireAdmin(() => {
      try {
        const run = getJobRun(runId);
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

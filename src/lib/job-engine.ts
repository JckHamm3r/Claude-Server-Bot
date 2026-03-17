import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  getJob, updateJob, createJobRun, updateJobRun, listJobs,
  type Job, type JobRunTrigger,
} from "./claude-db";
import { logActivity } from "./activity-log";
import { dispatchNotification } from "./notifications";
import db from "./db";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const LOGS_DIR = path.join(DATA_DIR, "job-logs");
const UNIT_PREFIX = "octoby-job-";
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB stored in DB; rest in log file

fs.mkdirSync(LOGS_DIR, { recursive: true });

function unitName(jobId: string): string {
  return `${UNIT_PREFIX}${jobId}`;
}

function serviceFilePath(jobId: string): string {
  return `/etc/systemd/system/${unitName(jobId)}.service`;
}

function timerFilePath(jobId: string): string {
  return `/etc/systemd/system/${unitName(jobId)}.timer`;
}

function wrapperScriptPath(jobId: string): string {
  return path.join(DATA_DIR, "job-scripts", `${jobId}-wrapper.sh`);
}

function logFilePath(jobId: string, runId: string): string {
  return path.join(LOGS_DIR, `${jobId}_${runId}.log`);
}

function runSudo(command: string): string {
  try {
    return execSync(`sudo ${command}`, { encoding: "utf-8", timeout: 15_000 }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[job-engine] sudo command failed: ${command}`, msg);
    throw new Error(`systemd command failed: ${msg}`);
  }
}

function daemonReload(): void {
  runSudo("systemctl daemon-reload");
}

/**
 * Generate the wrapper script that handles output capture and run tracking.
 * The wrapper calls our internal API on start and finish so the DB stays in sync.
 */
function generateWrapperScript(job: Job, apiBase: string): string {
  const envLines = Object.entries(job.environment)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("\n");

  const workDir = job.working_directory || process.env.CLAUDE_PROJECT_ROOT || process.cwd();
  const timeoutCmd = job.timeout_seconds > 0
    ? `timeout ${job.timeout_seconds}`
    : "";

  return `#!/bin/bash
set -o pipefail

JOB_ID="${job.id}"
API_BASE="${apiBase}"
TRIGGER="\${TRIGGER:-timer}"

# Notify API that run started
RUN_RESPONSE=$(curl -s -X POST "\${API_BASE}/api/jobs/\${JOB_ID}/notify-run" \\
  -H "Content-Type: application/json" \\
  -H "X-Job-Secret: \${JOB_SECRET}" \\
  -d "{\\"event\\":\\"start\\",\\"trigger\\":\\"\${TRIGGER}\\"}" 2>/dev/null || echo '{"run_id":"unknown"}')

RUN_ID=$(echo "\${RUN_RESPONSE}" | grep -o '"run_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "\${RUN_ID}" ] && RUN_ID="unknown"

LOG_DIR="${LOGS_DIR}"
mkdir -p "\${LOG_DIR}"
LOG_FILE="\${LOG_DIR}/\${JOB_ID}_\${RUN_ID}.log"

cd ${JSON.stringify(workDir)} 2>/dev/null || cd /tmp

${envLines}

START_MS=$(date +%s%3N 2>/dev/null || echo 0)

${timeoutCmd} ${JSON.stringify(job.script_path)} > "\${LOG_FILE}" 2>&1
EXIT_CODE=$?

END_MS=$(date +%s%3N 2>/dev/null || echo 0)
DURATION_MS=$(( END_MS - START_MS ))

# Truncate output for DB storage (last 64KB)
OUTPUT=$(tail -c ${MAX_OUTPUT_BYTES} "\${LOG_FILE}" 2>/dev/null || echo "")

# Notify API that run finished
curl -s -X POST "\${API_BASE}/api/jobs/\${JOB_ID}/notify-run" \\
  -H "Content-Type: application/json" \\
  -H "X-Job-Secret: \${JOB_SECRET}" \\
  -d "$(printf '{"event":"finish","run_id":"%s","exit_code":%d,"duration_ms":%d,"output":"%s","log_path":"%s"}' \\
    "\${RUN_ID}" "\${EXIT_CODE}" "\${DURATION_MS}" \\
    "$(echo "\${OUTPUT}" | head -c 4096 | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\\n' ' ')" \\
    "\${LOG_FILE}")" 2>/dev/null || true

exit \${EXIT_CODE}
`;
}

function generateServiceUnit(job: Job): string {
  const wrapperPath = wrapperScriptPath(job.id);
  const env = Object.entries(job.environment)
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join("\n");

  return `[Unit]
Description=Octoby Job: ${job.name}
After=network.target

[Service]
Type=oneshot
ExecStart=/bin/bash ${wrapperPath}
Environment=JOB_SECRET=${getOrCreateJobSecret()}
${env}
${job.timeout_seconds > 0 ? `TimeoutStopSec=${job.timeout_seconds + 10}` : ""}

[Install]
WantedBy=multi-user.target
`;
}

function generateTimerUnit(job: Job): string {
  return `[Unit]
Description=Timer for Octoby Job: ${job.name}

[Timer]
OnCalendar=${job.schedule}
Persistent=true
AccuracySec=1min

[Install]
WantedBy=timers.target
`;
}

let jobSecret: string | null = null;

function getOrCreateJobSecret(): string {
  if (jobSecret) return jobSecret;
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'job_runner_secret'").get() as { value: string } | undefined;
    if (row?.value) {
      jobSecret = row.value;
      return jobSecret;
    }
  } catch { /* ignore */ }
  const secret = require("crypto").randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('job_runner_secret', ?) ON CONFLICT(key) DO UPDATE SET value = ?"
  ).run(secret, secret);
  jobSecret = secret;
  return secret;
}

export function validateJobSecret(secret: string): boolean {
  return secret === getOrCreateJobSecret();
}

/**
 * Install a job's systemd timer and service files.
 */
export function installJob(jobId: string): { ok: boolean; error?: string } {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: "Job not found" };

  try {
    const apiBase = process.env.NEXTAUTH_URL || `http://localhost:${process.env.PORT || 3000}`;

    // Create wrapper script
    const scriptsDir = path.join(DATA_DIR, "job-scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    const wrapperPath = wrapperScriptPath(jobId);
    fs.writeFileSync(wrapperPath, generateWrapperScript(job, apiBase), { mode: 0o755 });

    // Write systemd unit files
    const serviceContent = generateServiceUnit(job);
    const timerContent = generateTimerUnit(job);

    const tmpService = path.join(DATA_DIR, `tmp-${jobId}.service`);
    const tmpTimer = path.join(DATA_DIR, `tmp-${jobId}.timer`);
    fs.writeFileSync(tmpService, serviceContent);
    fs.writeFileSync(tmpTimer, timerContent);

    runSudo(`cp ${tmpService} ${serviceFilePath(jobId)}`);
    runSudo(`cp ${tmpTimer} ${timerFilePath(jobId)}`);
    fs.unlinkSync(tmpService);
    fs.unlinkSync(tmpTimer);

    daemonReload();

    if (job.status === "active") {
      runSudo(`systemctl enable --now ${unitName(jobId)}.timer`);
    }

    updateJob(jobId, { systemd_unit: unitName(jobId) });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[job-engine] Failed to install job ${jobId}:`, msg);
    return { ok: false, error: msg };
  }
}

/**
 * Uninstall a job's systemd timer and service files.
 */
export function uninstallJob(jobId: string): { ok: boolean; error?: string } {
  try {
    try {
      runSudo(`systemctl stop ${unitName(jobId)}.timer`);
    } catch { /* might not exist */ }
    try {
      runSudo(`systemctl disable ${unitName(jobId)}.timer`);
    } catch { /* might not exist */ }

    const svcPath = serviceFilePath(jobId);
    const tmrPath = timerFilePath(jobId);
    if (fs.existsSync(svcPath)) runSudo(`rm ${svcPath}`);
    if (fs.existsSync(tmrPath)) runSudo(`rm ${tmrPath}`);

    const wrapperPath = wrapperScriptPath(jobId);
    if (fs.existsSync(wrapperPath)) fs.unlinkSync(wrapperPath);

    daemonReload();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[job-engine] Failed to uninstall job ${jobId}:`, msg);
    return { ok: false, error: msg };
  }
}

/**
 * Enable a paused job's timer.
 */
export function enableJob(jobId: string): { ok: boolean; error?: string } {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: "Job not found" };

  try {
    if (!job.systemd_unit) {
      const installResult = installJob(jobId);
      if (!installResult.ok) return installResult;
    }
    runSudo(`systemctl enable --now ${unitName(jobId)}.timer`);
    updateJob(jobId, { status: "active", consecutive_failures: 0 });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Disable (pause) a job's timer without removing it.
 */
export function disableJob(jobId: string): { ok: boolean; error?: string } {
  try {
    try {
      runSudo(`systemctl stop ${unitName(jobId)}.timer`);
    } catch { /* ignore */ }
    try {
      runSudo(`systemctl disable ${unitName(jobId)}.timer`);
    } catch { /* ignore */ }
    updateJob(jobId, { status: "paused" });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Run a job immediately (outside its schedule).
 */
export function runJobNow(jobId: string, userEmail: string): { ok: boolean; runId?: string; error?: string } {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: "Job not found" };

  const run = createJobRun(jobId, "manual");

  updateJob(jobId, { last_run_at: run.started_at, last_run_status: "running" });

  const apiBase = process.env.NEXTAUTH_URL || `http://localhost:${process.env.PORT || 3000}`;
  const scriptsDir = path.join(DATA_DIR, "job-scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });

  const wrapperPath = wrapperScriptPath(jobId);
  if (!fs.existsSync(wrapperPath)) {
    fs.writeFileSync(wrapperPath, generateWrapperScript(job, apiBase), { mode: 0o755 });
  }

  const child = spawn("bash", [wrapperPath], {
    env: {
      ...process.env,
      TRIGGER: "manual",
      JOB_SECRET: getOrCreateJobSecret(),
    },
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  logActivity("job_run_manual" as never, userEmail, { jobId, jobName: job.name, runId: run.id });

  return { ok: true, runId: run.id };
}

/**
 * Handle a run start notification from the wrapper script.
 */
export function handleRunStart(jobId: string, trigger: JobRunTrigger): string {
  const run = createJobRun(jobId, trigger);
  updateJob(jobId, { last_run_at: run.started_at, last_run_status: "running" });
  return run.id;
}

/**
 * Handle a run finish notification from the wrapper script.
 */
export async function handleRunFinish(
  jobId: string,
  runId: string,
  exitCode: number,
  durationMs: number,
  output: string,
  logPath: string,
): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  const status = exitCode === 0 ? "success" as const : "failed" as const;
  const truncatedOutput = output.length > MAX_OUTPUT_BYTES
    ? output.slice(-MAX_OUTPUT_BYTES)
    : output;

  if (runId && runId !== "unknown") {
    updateJobRun(runId, {
      finished_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
      status,
      exit_code: exitCode,
      output: truncatedOutput,
      output_log_path: logPath || undefined,
      duration_ms: durationMs,
      error_summary: status === "failed" ? `Exit code ${exitCode}` : undefined,
    });
  }

  const consecutive = status === "failed" ? job.consecutive_failures + 1 : 0;
  const jobUpdate: Parameters<typeof updateJob>[1] = {
    last_run_at: new Date().toISOString().replace("T", " ").replace("Z", ""),
    last_run_status: status,
    run_count: job.run_count + 1,
    fail_count: status === "failed" ? job.fail_count + 1 : job.fail_count,
    consecutive_failures: consecutive,
  };

  // Auto-disable after N consecutive failures
  if (job.auto_disable_after > 0 && consecutive >= job.auto_disable_after) {
    jobUpdate.status = "failed";
    disableJob(jobId);

    await dispatchNotification(
      "job_failed" as never,
      job.created_by,
      `Job auto-disabled: ${job.name}`,
      `"${job.name}" was automatically disabled after ${consecutive} consecutive failures.`,
    ).catch(() => {});

    logActivity("job_auto_disabled" as never, null, { jobId, jobName: job.name, consecutive });
  }

  updateJob(jobId, jobUpdate);

  // Send notifications
  if (status === "failed" && job.notify_on_failure) {
    await dispatchNotification(
      "job_failed" as never,
      job.created_by,
      `Job failed: ${job.name}`,
      `"${job.name}" failed with exit code ${exitCode}.`,
    ).catch(() => {});
  }

  if (status === "success" && job.notify_on_success) {
    await dispatchNotification(
      "job_completed" as never,
      job.created_by,
      `Job completed: ${job.name}`,
      `"${job.name}" completed successfully in ${Math.round(durationMs / 1000)}s.`,
    ).catch(() => {});
  }
}

/**
 * Get the next run time for a timer from systemd.
 */
export function getTimerNextRun(jobId: string): string | null {
  try {
    const output = execSync(
      `systemctl show ${unitName(jobId)}.timer --property=NextElapseUSecRealtime --no-pager`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();
    const match = output.match(/NextElapseUSecRealtime=(.+)/);
    if (match && match[1] && match[1] !== "n/a") {
      return match[1];
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Check if a timer is currently active.
 */
export function isTimerActive(jobId: string): boolean {
  try {
    const output = execSync(
      `systemctl is-active ${unitName(jobId)}.timer 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();
    return output === "active";
  } catch {
    return false;
  }
}

/**
 * Sync job statuses with systemd (called periodically).
 */
export function syncJobStatuses(): void {
  try {
    const jobs = listJobs();
    for (const job of jobs) {
      if (!job.systemd_unit) continue;
      const active = isTimerActive(job.id);
      const nextRun = active ? getTimerNextRun(job.id) : null;
      if (nextRun !== job.next_run_at) {
        updateJob(job.id, { next_run_at: nextRun });
      }
    }
  } catch (err) {
    console.error("[job-engine] Status sync error:", err);
  }
}

/**
 * Get the log file content for a run.
 */
export function getRunLogContent(jobId: string, runId: string, tailBytes = MAX_OUTPUT_BYTES): string {
  const logPath = logFilePath(jobId, runId);
  try {
    if (!fs.existsSync(logPath)) return "";
    const stat = fs.statSync(logPath);
    if (stat.size <= tailBytes) {
      return fs.readFileSync(logPath, "utf-8");
    }
    const fd = fs.openSync(logPath, "r");
    const buffer = Buffer.alloc(tailBytes);
    fs.readSync(fd, buffer, 0, tailBytes, stat.size - tailBytes);
    fs.closeSync(fd);
    return buffer.toString("utf-8");
  } catch {
    return "";
  }
}

// Pre-built job templates
export const JOB_TEMPLATES = [
  {
    id: "backup-database",
    name: "Database Backup",
    description: "Create a timestamped backup of the SQLite database daily",
    icon: "💾",
    schedule: "*-*-* 02:00:00",
    schedule_display: "Daily at 2:00 AM",
    script_hint: "A script that copies the SQLite database to a backup directory with a timestamp",
  },
  {
    id: "ssl-cert-check",
    name: "SSL Certificate Check",
    description: "Check SSL certificate expiration weekly and alert if expiring soon",
    icon: "🔒",
    schedule: "Mon *-*-* 09:00:00",
    schedule_display: "Every Monday at 9:00 AM",
    script_hint: "A script that checks SSL certificate expiry dates and alerts if within 30 days",
  },
  {
    id: "disk-cleanup",
    name: "Disk Space Cleanup",
    description: "Clean up old logs, temp files, and caches when disk usage is high",
    icon: "🧹",
    schedule: "*-*-* 03:00:00",
    schedule_display: "Daily at 3:00 AM",
    script_hint: "A script that removes old log files, temp files, and package caches to free disk space",
  },
  {
    id: "log-rotation",
    name: "Log Rotation",
    description: "Compress and rotate application logs to prevent disk bloat",
    icon: "📋",
    schedule: "*-*-* 00:00:00",
    schedule_display: "Daily at midnight",
    script_hint: "A script that compresses logs older than 7 days and deletes those older than 30 days",
  },
  {
    id: "system-health",
    name: "System Health Report",
    description: "Generate a system health report with CPU, memory, and disk stats",
    icon: "📊",
    schedule: "*-*-* *:00:00",
    schedule_display: "Every hour",
    script_hint: "A script that logs CPU, memory, disk usage, and running process count",
  },
  {
    id: "git-pull",
    name: "Git Repository Sync",
    description: "Pull the latest changes from a remote git repository",
    icon: "🔄",
    schedule: "*-*-* *:*/15:00",
    schedule_display: "Every 15 minutes",
    script_hint: "A script that runs git pull in a specified repository directory",
  },
];

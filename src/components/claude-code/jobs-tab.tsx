"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import type { Job, JobRun } from "@/lib/claude-db";
import { JobListView } from "./job-list-view";
import { CreateJobDialog } from "./create-job-dialog";
import { JobDetailDrawer } from "./job-detail-drawer";
import { AiJobBuilder } from "./ai-job-builder";

export function JobsTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAiBuilder, setShowAiBuilder] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [detailRuns, setDetailRuns] = useState<JobRun[]>([]);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  useEffect(() => {
    socketRef.current = getSocket();
    const socket = socketRef.current;

    const handleJobs = ({ jobs: j }: { jobs: Job[] }) => {
      setJobs(j);
      if (detailJob) {
        const updated = j.find((jb) => jb.id === detailJob.id);
        if (updated) setDetailJob(updated);
      }
    };

    const handleJobUpdated = ({ job }: { job: Job }) => {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      if (detailJob?.id === job.id) setDetailJob(job);
    };

    const handleJobDeleted = ({ jobId }: { jobId: string }) => {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (detailJob?.id === jobId) setDetailJob(null);
    };

    const handleJobRuns = ({ jobId, runs }: { jobId: string; runs: JobRun[] }) => {
      if (detailJob?.id === jobId) setDetailRuns(runs);
    };

    socket.on("claude:jobs", handleJobs);
    socket.on("claude:job_updated", handleJobUpdated);
    socket.on("claude:job_created", handleJobUpdated);
    socket.on("claude:job_deleted", handleJobDeleted);
    socket.on("claude:job_runs", handleJobRuns);

    if (socket.connected) {
      socket.emit("claude:list_jobs");
    }

    const handleConnect = () => {
      socket.emit("claude:list_jobs");
    };
    socket.on("connect", handleConnect);

    return () => {
      socket.off("claude:jobs", handleJobs);
      socket.off("claude:job_updated", handleJobUpdated);
      socket.off("claude:job_created", handleJobUpdated);
      socket.off("claude:job_deleted", handleJobDeleted);
      socket.off("claude:job_runs", handleJobRuns);
      socket.off("connect", handleConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailJob?.id]);

  const handleNew = useCallback(() => {
    setSelectedJob(null);
    setShowCreateDialog(true);
  }, []);

  const handleAiBuilder = useCallback(() => {
    setShowAiBuilder(true);
  }, []);

  const handleEdit = useCallback((job: Job) => {
    setSelectedJob(job);
    setShowCreateDialog(true);
  }, []);

  const handleSave = useCallback(
    (data: Record<string, unknown>) => {
      if (selectedJob) {
        emit("claude:update_job", { jobId: selectedJob.id, data });
      } else {
        emit("claude:create_job", data);
      }
      setShowCreateDialog(false);
      setSelectedJob(null);
    },
    [selectedJob, emit],
  );

  const handleDelete = useCallback(
    (jobId: string) => {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      emit("claude:delete_job", { jobId });
    },
    [emit],
  );

  const handleToggle = useCallback(
    (job: Job) => {
      const newStatus = job.status === "active" ? "paused" : "active";
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: newStatus } as Job : j)),
      );
      emit("claude:toggle_job", { jobId: job.id });
    },
    [emit],
  );

  const handleRunNow = useCallback(
    (jobId: string) => {
      emit("claude:run_job_now", { jobId });
    },
    [emit],
  );

  const handleViewDetail = useCallback(
    (job: Job) => {
      setDetailJob(job);
      setDetailRuns([]);
      emit("claude:get_job_runs", { jobId: job.id });
    },
    [emit],
  );

  const handleRefreshRuns = useCallback(
    (jobId: string) => {
      emit("claude:get_job_runs", { jobId });
    },
    [emit],
  );

  const handleAiJobCreated = useCallback(
    (data: Record<string, unknown>) => {
      emit("claude:create_job", { ...data, ai_generated: true });
      setShowAiBuilder(false);
    },
    [emit],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <JobListView
        jobs={jobs}
        onNew={handleNew}
        onAiBuilder={handleAiBuilder}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggle={handleToggle}
        onRunNow={handleRunNow}
        onViewDetail={handleViewDetail}
      />

      {showCreateDialog && (
        <CreateJobDialog
          onClose={() => {
            setShowCreateDialog(false);
            setSelectedJob(null);
          }}
          onSave={handleSave}
          initialData={selectedJob ?? undefined}
          isEditing={!!selectedJob}
        />
      )}

      {detailJob && (
        <JobDetailDrawer
          job={detailJob}
          runs={detailRuns}
          onClose={() => setDetailJob(null)}
          onEdit={() => handleEdit(detailJob)}
          onToggle={() => handleToggle(detailJob)}
          onRunNow={() => handleRunNow(detailJob.id)}
          onRefreshRuns={() => handleRefreshRuns(detailJob.id)}
        />
      )}

      {showAiBuilder && (
        <AiJobBuilder
          onClose={() => setShowAiBuilder(false)}
          onJobCreated={handleAiJobCreated}
        />
      )}
    </div>
  );
}

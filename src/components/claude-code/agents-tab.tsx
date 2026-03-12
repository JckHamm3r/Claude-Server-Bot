"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import type { ClaudeAgent, ClaudeAgentVersion } from "@/lib/claude-db";
import { AgentListView } from "./agent-list-view";
import { CreateAgentDialog } from "./create-agent-dialog";
import { AgentVersionHistory } from "./agent-version-history";

interface AgentFormData {
  icon: string;
  name: string;
  description: string;
  model: string;
  allowed_tools: string[];
}

export function AgentsTab() {
  const [agents, setAgents] = useState<ClaudeAgent[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<ClaudeAgent | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionAgent, setVersionAgent] = useState<ClaudeAgent | null>(null);
  const [versions, setVersions] = useState<ClaudeAgentVersion[]>([]);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  useEffect(() => {
    socketRef.current = getSocket();
    const socket = socketRef.current;

    const handleAgents = ({ agents: a }: { agents: ClaudeAgent[] }) => {
      setAgents(a);
    };

    const handleVersions = ({
      agentId,
      versions: v,
    }: {
      agentId: string;
      versions: ClaudeAgentVersion[];
    }) => {
      // Only apply if we're showing versions for the same agent
      setVersions(v);
      // Update the versionAgent reference in case agent changed
      setVersionAgent((prev) => (prev?.id === agentId ? prev : prev));
    };

    socket.on("claude:agents", handleAgents);
    socket.on("claude:agent_versions", handleVersions);

    if (socket.connected) {
      socket.emit("claude:list_agents");
    }

    socket.on("connect", () => {
      socket.emit("claude:list_agents");
    });

    return () => {
      socket.off("claude:agents", handleAgents);
      socket.off("claude:agent_versions", handleVersions);
      socket.off("connect");
    };
  }, []);

  const handleNew = useCallback(() => {
    setSelectedAgent(null);
    setShowCreateDialog(true);
  }, []);

  const handleEdit = useCallback((agent: ClaudeAgent) => {
    setSelectedAgent(agent);
    setShowCreateDialog(true);
  }, []);

  const handleSave = useCallback(
    (data: AgentFormData) => {
      if (selectedAgent) {
        emit("claude:update_agent", {
          agentId: selectedAgent.id,
          data,
          changeDescription: "Updated via UI",
        });
      } else {
        emit("claude:create_agent", data);
      }
      setShowCreateDialog(false);
      setSelectedAgent(null);
    },
    [selectedAgent, emit],
  );

  const handleDelete = useCallback(
    (agentId: string) => {
      // Optimistic removal
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
      emit("claude:delete_agent", { agentId });
    },
    [emit],
  );

  const handleToggleStatus = useCallback(
    (agent: ClaudeAgent) => {
      const newStatus = agent.status === "active" ? "disabled" : "active";
      // Optimistic update
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, status: newStatus } : a)),
      );
      emit("claude:update_agent", {
        agentId: agent.id,
        data: { status: newStatus },
        changeDescription: newStatus === "active" ? "Enabled" : "Disabled",
      });
    },
    [emit],
  );

  const handleArchive = useCallback(
    (agentId: string) => {
      // Optimistic update
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, status: "archived" as const } : a)),
      );
      emit("claude:update_agent", {
        agentId,
        data: { status: "archived" },
        changeDescription: "Archived",
      });
    },
    [emit],
  );

  const handleViewVersions = useCallback(
    (agent: ClaudeAgent) => {
      setVersionAgent(agent);
      setVersions([]);
      setShowVersionHistory(true);
      emit("claude:get_agent_versions", { agentId: agent.id });
    },
    [emit],
  );

  const handleRollback = useCallback(
    (version: ClaudeAgentVersion) => {
      if (!versionAgent) return;
      const snapshot = version.config_snapshot;
      emit("claude:update_agent", {
        agentId: versionAgent.id,
        data: {
          name: snapshot.name,
          description: snapshot.description,
          icon: snapshot.icon ?? undefined,
          model: snapshot.model,
          allowed_tools: snapshot.allowed_tools,
          status: snapshot.status,
        },
        changeDescription: `Rolled back to v${version.version_number}`,
      });
      setShowVersionHistory(false);
    },
    [versionAgent, emit],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AgentListView
        agents={agents}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggleStatus={handleToggleStatus}
        onArchive={handleArchive}
        onViewVersions={handleViewVersions}
        onNew={handleNew}
      />

      {showCreateDialog && (
        <CreateAgentDialog
          onClose={() => {
            setShowCreateDialog(false);
            setSelectedAgent(null);
          }}
          onSave={handleSave}
          initialData={selectedAgent ?? undefined}
          isEditing={!!selectedAgent}
        />
      )}

      {showVersionHistory && versionAgent && (
        <AgentVersionHistory
          agent={versionAgent}
          versions={versions}
          onClose={() => setShowVersionHistory(false)}
          onRollback={handleRollback}
        />
      )}
    </div>
  );
}

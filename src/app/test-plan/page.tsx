"use client";

import { PlanStepList } from "@/components/claude-code/plan-step-list";
import type { ClaudePlan, ClaudePlanStep } from "@/lib/claude-db";

// Mock plan data for testing
const mockSteps: ClaudePlanStep[] = [
  {
    id: "step-1",
    plan_id: "test-plan",
    step_order: 1,
    summary: "Create user model and database schema",
    details: "Define User model with fields: email, password_hash, created_at. Add migration to create users table.",
    status: "approved",
    result: null,
    error: null,
    approved_by: null,
    executed_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "step-2",
    plan_id: "test-plan",
    step_order: 2,
    summary: "Implement password hashing utility",
    details: "Use bcrypt to hash passwords securely. Create utility functions for hash and verify.",
    status: "pending",
    result: null,
    error: null,
    approved_by: null,
    executed_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "step-3",
    plan_id: "test-plan",
    step_order: 3,
    summary: "Build registration endpoint",
    details: "Create POST /api/register endpoint that accepts email and password, validates input, and creates user.",
    status: "pending",
    result: null,
    error: null,
    approved_by: null,
    executed_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "step-4",
    plan_id: "test-plan",
    step_order: 4,
    summary: "Build login endpoint",
    details: "Create POST /api/login endpoint that verifies credentials and returns JWT token.",
    status: "pending",
    result: null,
    error: null,
    approved_by: null,
    executed_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "step-5",
    plan_id: "test-plan",
    step_order: 5,
    summary: "Add authentication middleware",
    details: "Create middleware to verify JWT tokens on protected routes.",
    status: "pending",
    result: null,
    error: null,
    approved_by: null,
    executed_at: null,
    created_at: new Date().toISOString(),
  },
];

const mockPlan: ClaudePlan = {
  id: "test-plan",
  session_id: "test-session",
  goal: "Add user authentication",
  status: "reviewing",
  created_by: "admin@dev.local",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  steps: mockSteps,
};

export default function TestPlanPage() {
  return (
    <div className="min-h-screen bg-bot-base p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-bot-text">
          Plan Mode - Expandable Sections Test
        </h1>
        <PlanStepList
          plan={mockPlan}
          onApprove={(stepId) => console.log("Approve", stepId)}
          onReject={(stepId) => console.log("Reject", stepId)}
          onApproveAll={() => console.log("Approve all")}
          onRejectAll={() => console.log("Reject all")}
          onReorder={(stepId, newOrder) => console.log("Reorder", stepId, newOrder)}
          onEdit={(stepId, summary, details) => console.log("Edit", stepId, summary, details)}
          onExecute={() => console.log("Execute")}
          onCancel={() => console.log("Cancel")}
          onRetry={() => console.log("Retry")}
          onSkip={() => console.log("Skip")}
          onDelete={() => console.log("Delete")}
          executing={false}
        />
      </div>
    </div>
  );
}

"use client";

export function SkipPermissionsBanner() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-bot-red/50 bg-bot-red/10 px-4 py-2 text-body text-bot-red">
      <span className="font-bold">⚠ Dangerous mode:</span>
      <span>skip-permissions is enabled — Claude can execute any command without confirmation.</span>
    </div>
  );
}

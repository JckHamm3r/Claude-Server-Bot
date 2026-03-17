"use client";

import { TerminalManager } from "@/components/terminal/TerminalManager";

interface TerminalTabProps {
  isAdmin: boolean;
}

export function TerminalTab({ isAdmin }: TerminalTabProps) {
  return <TerminalManager isAdmin={isAdmin} />;
}

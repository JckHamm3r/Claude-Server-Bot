"use client";

import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "@/lib/utils";

export interface UserGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  is_system: number;
  created_at: string;
  updated_at: string;
  member_count: number;
}

export function useGroups() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mutate = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch(apiUrl("/api/groups"));
      if (!res.ok) throw new Error(`Failed to fetch groups: ${res.status}`);
      const data = await res.json() as { groups: UserGroup[] };
      setGroups(data.groups ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mutate();
  }, [mutate]);

  return {
    groups,
    isLoading,
    error,
    mutate,
  };
}

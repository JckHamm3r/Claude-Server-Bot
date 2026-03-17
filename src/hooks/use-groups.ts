"use client";

import useSWR from "swr";

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useGroups() {
  const basePath = typeof window !== 'undefined'
    ? (document.querySelector('meta[name="base-path"]') as HTMLMetaElement | null)?.content ?? ''
    : '';

  const { data, error, isLoading, mutate } = useSWR<{ groups: UserGroup[] }>(
    `${basePath}/api/groups`,
    fetcher,
    { revalidateOnFocus: false }
  );

  return {
    groups: data?.groups ?? [],
    isLoading,
    error,
    mutate,
  };
}

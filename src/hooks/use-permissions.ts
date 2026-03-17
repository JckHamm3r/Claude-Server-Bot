"use client";

import useSWR from "swr";

export interface PlatformPermissions {
  sessions_create: boolean;
  sessions_view_others: boolean;
  sessions_collaborate: boolean;
  templates_view: boolean;
  templates_manage: boolean;
  memories_view: boolean;
  memories_manage: boolean;
  files_browse: boolean;
  files_upload: boolean;
  terminal_access: boolean;
}

export interface AiPermissions {
  commands_allowed: string[];
  commands_blocked: string[];
  shell_access: boolean;
  full_trust_allowed: boolean;
  directories_allowed: string[];
  directories_blocked: string[];
  filetypes_allowed: string[];
  filetypes_blocked: string[];
  read_only: boolean;
}

export interface SessionPermissions {
  max_active: number;
  max_turns: number;
  models_allowed: string[];
  delegation_enabled: boolean;
  delegation_max_depth: number;
  default_model: string;
  default_template: string;
}

export interface EffectivePermissions {
  platform: PlatformPermissions;
  ai: AiPermissions;
  session: SessionPermissions;
  prompt: {
    system_prompt_append: string;
    default_context: string;
  };
}

const DEFAULT_PERMISSIONS: EffectivePermissions = {
  platform: {
    sessions_create: true,
    sessions_view_others: false,
    sessions_collaborate: true,
    templates_view: true,
    templates_manage: false,
    memories_view: true,
    memories_manage: true,
    files_browse: true,
    files_upload: true,
    terminal_access: true,
  },
  ai: {
    commands_allowed: [],
    commands_blocked: [],
    shell_access: true,
    full_trust_allowed: true,
    directories_allowed: [],
    directories_blocked: [],
    filetypes_allowed: [],
    filetypes_blocked: [],
    read_only: false,
  },
  session: {
    max_active: 0,
    max_turns: 0,
    models_allowed: [],
    delegation_enabled: true,
    delegation_max_depth: 5,
    default_model: '',
    default_template: '',
  },
  prompt: {
    system_prompt_append: '',
    default_context: '',
  },
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function usePermissions() {
  const basePath = typeof window !== 'undefined'
    ? (document.querySelector('meta[name="base-path"]') as HTMLMetaElement | null)?.content ?? ''
    : '';

  const { data, error, isLoading } = useSWR<{ permissions: EffectivePermissions; isAdmin: boolean }>(
    `${basePath}/api/groups/my-permissions`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  const permissions = data?.permissions ?? DEFAULT_PERMISSIONS;
  const isAdmin = data?.isAdmin ?? false;

  function can(permission: keyof PlatformPermissions): boolean {
    if (isAdmin) return true;
    return permissions.platform[permission] ?? true;
  }

  return {
    permissions,
    isAdmin,
    can,
    isLoading,
    error,
  };
}

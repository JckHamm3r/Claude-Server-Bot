"use client";

import { useState, useEffect } from "react";
import { apiUrl } from "@/lib/utils";
import type { GroupPermissions } from "@/lib/claude-db";

export interface UserProfile {
  auto_summary: boolean;
  profile_wizard_complete: boolean;
  server_purposes: string[];
  project_type: string;
  /** Group permissions for the current user (null = admin with no restrictions) */
  groupPermissions: GroupPermissions | null;
  /** True when the user is a platform admin (bypasses group restrictions) */
  isAdmin: boolean;
}

const DEFAULT_PERMISSIONS: GroupPermissions = {
  platform: {
    sessions_create: true,
    sessions_view_others: false,
    sessions_collaborate: true,
    templates_view: true,
    templates_manage: false,
    memories_view: true,
    memories_manage: false,
    files_browse: true,
    files_upload: false,
    terminal_access: false,
    observe_only: false,
    visible_tabs: ["chat", "agents", "plan", "memory"],
    visible_settings: ["general", "notifications"],
  },
  ai: {
    commands_allowed: [],
    commands_blocked: [],
    shell_access: false,
    full_trust_allowed: false,
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
    delegation_enabled: false,
    delegation_max_depth: 2,
    default_model: "",
    default_template: "",
  },
  prompt: {
    system_prompt_append: "",
    default_context: "",
    communication_style: "intermediate",
  },
};

const DEFAULT_PROFILE: UserProfile = {
  auto_summary: true,
  profile_wizard_complete: false,
  server_purposes: [],
  project_type: "",
  groupPermissions: DEFAULT_PERMISSIONS,
  isAdmin: false,
};

let cachedProfile: UserProfile | null = null;
const listeners: Set<(p: UserProfile) => void> = new Set();

function broadcastProfile(p: UserProfile) {
  cachedProfile = p;
  listeners.forEach((fn) => fn(p));
}

export async function fetchAndCacheProfile(): Promise<UserProfile> {
  try {
    const [profileRes, permsRes] = await Promise.all([
      fetch(apiUrl("/api/users/profile")),
      fetch(apiUrl("/api/groups/my-permissions")),
    ]);

    const profileData = profileRes.ok ? await profileRes.json() as Record<string, unknown> : {};
    const permsData = permsRes.ok ? await permsRes.json() as { permissions: GroupPermissions; isAdmin: boolean } : null;

    const profile: UserProfile = {
      auto_summary: (profileData.auto_summary as boolean) ?? true,
      profile_wizard_complete: (profileData.profile_wizard_complete as boolean) ?? false,
      server_purposes: (profileData.server_purposes as string[]) ?? [],
      project_type: (profileData.project_type as string) ?? "",
      groupPermissions: permsData?.isAdmin ? null : (permsData?.permissions ?? DEFAULT_PERMISSIONS),
      isAdmin: permsData?.isAdmin ?? false,
    };
    broadcastProfile(profile);
    return profile;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function useUserProfile(): UserProfile {
  const [profile, setProfile] = useState<UserProfile>(cachedProfile ?? DEFAULT_PROFILE);

  useEffect(() => {
    listeners.add(setProfile);

    if (!cachedProfile) {
      fetchAndCacheProfile().then(setProfile);
    } else {
      setProfile(cachedProfile);
    }

    return () => { listeners.delete(setProfile); };
  }, []);

  return profile;
}

/** Invalidate the cache so the next render fetches fresh data. */
export function invalidateProfileCache() {
  cachedProfile = null;
}

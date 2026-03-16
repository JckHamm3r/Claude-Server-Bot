"use client";

import { useState, useEffect } from "react";
import { apiUrl } from "@/lib/utils";
import type { ExperienceLevel } from "@/lib/user-profile-constants";

export interface UserProfile {
  experience_level: ExperienceLevel;
  server_purposes: string[];
  project_type: string;
  auto_summary: boolean;
  profile_wizard_complete: boolean;
}

const DEFAULT_PROFILE: UserProfile = {
  experience_level: "expert",
  server_purposes: [],
  project_type: "",
  auto_summary: true,
  profile_wizard_complete: false,
};

let cachedProfile: UserProfile | null = null;
const listeners: Set<(p: UserProfile) => void> = new Set();

function broadcastProfile(p: UserProfile) {
  cachedProfile = p;
  listeners.forEach((fn) => fn(p));
}

export async function fetchAndCacheProfile(): Promise<UserProfile> {
  try {
    const res = await fetch(apiUrl("/api/users/profile"));
    if (!res.ok) return DEFAULT_PROFILE;
    const data = await res.json() as Partial<UserProfile>;
    const profile: UserProfile = {
      experience_level: (data.experience_level as ExperienceLevel) ?? "expert",
      server_purposes: data.server_purposes ?? [],
      project_type: data.project_type ?? "",
      auto_summary: data.auto_summary ?? true,
      profile_wizard_complete: data.profile_wizard_complete ?? false,
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

export type AvatarState = "thinking" | "working" | "error" | "questioning" | "waiting" | "idle";

export function getAvatarPath(state: AvatarState): string {
  switch (state) {
    case "thinking": return "/avatars/thinking.png";
    case "working": return "/avatars/working.png";
    case "error": return "/avatars/error.png";
    case "questioning": return "/avatars/questioning.png";
    case "waiting": return "/avatars/waiting.png";
    default: return "/avatars/waiting.png";
  }
}

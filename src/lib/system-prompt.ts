import { getAppSetting, getPersonalityPrefix } from "./app-settings";
import { getCustomizationSystemPrompt, getBotSelfIdentityPrompt } from "./customization";
import { getSecuritySystemPrompt } from "./security-guard";

export type InterfaceType = "ui_chat" | "customization_interface" | "system_agent";

interface BuildSystemPromptOpts {
  interfaceType?: InterfaceType;
  personality?: string;
  personalityCustom?: string;
  templateSystemPrompt?: string;
}

/**
 * Single source of truth for composing the system prompt sent to Claude.
 * Composition order: security → template → identity + personality
 */
export async function buildSystemPrompt(opts: BuildSystemPromptOpts = {}): Promise<string | undefined> {
  const {
    interfaceType = "ui_chat",
    personality,
    personalityCustom,
    templateSystemPrompt,
  } = opts;

  let systemPrompt: string | undefined;

  if (interfaceType === "customization_interface") {
    systemPrompt = await getCustomizationSystemPrompt();
  } else if (interfaceType === "system_agent") {
    systemPrompt = undefined;
  } else {
    const parts: string[] = [];
    const selfIdentity = getBotSelfIdentityPrompt();
    if (selfIdentity) parts.push(selfIdentity);
    const personalityPrefix = getPersonalityPrefix(personality ?? "professional", personalityCustom);
    if (personalityPrefix) parts.push(personalityPrefix);
    systemPrompt = parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  if (templateSystemPrompt) {
    systemPrompt = systemPrompt
      ? templateSystemPrompt + "\n\n" + systemPrompt
      : templateSystemPrompt;
  }

  const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
  const securityPrefix = getSecuritySystemPrompt(guardEnabled);
  if (securityPrefix) {
    systemPrompt = systemPrompt
      ? securityPrefix + "\n\n" + systemPrompt
      : securityPrefix;
  }

  return systemPrompt;
}

export type TransformerType = "theme" | "prompt" | "api" | "hook" | "static" | "widget";

export type TransformerStatus = "active" | "disabled" | "error" | "loading";

export type ConfigFieldType = "string" | "text" | "number" | "boolean" | "select" | "multi-select" | "password";

export interface ConfigFieldDef {
  type: ConfigFieldType;
  label: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean | string[];
  options?: string[];
  placeholder?: string;
}

export interface TransformerManifest {
  id: string;
  name: string;
  description: string;
  type: TransformerType;
  version: string;
  author?: string;
  created: string;
  updated?: string;
  enabled: boolean;
  icon?: string;
  entry?: string;
  config?: Record<string, ConfigFieldDef>;
  promptTargets?: ("ui_chat" | "customization_interface" | "system_agent" | "all")[];
  tags?: string[];
}

export interface TransformerRecord extends TransformerManifest {
  status: TransformerStatus;
  errorMessage?: string;
  dirPath: string;
  configValues?: Record<string, string | number | boolean | string[]>;
  gitLog?: GitLogEntry[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
}

export function validateManifest(data: unknown): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") return { valid: false, error: "Not an object" };
  const m = data as Record<string, unknown>;
  const required = ["id", "name", "description", "type", "version", "enabled"];
  for (const f of required) {
    if (m[f] === undefined || m[f] === null) return { valid: false, error: `Missing required field: ${f}` };
  }
  const validTypes: TransformerType[] = ["theme", "prompt", "api", "hook", "static", "widget"];
  if (!validTypes.includes(m.type as TransformerType)) {
    return { valid: false, error: `Invalid type: ${m.type}. Must be one of: ${validTypes.join(", ")}` };
  }
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(m.id)) {
    return { valid: false, error: "id must be lowercase alphanumeric with hyphens (e.g. my-transformer)" };
  }
  return { valid: true };
}

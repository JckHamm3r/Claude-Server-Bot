import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { TransformerManifest, TransformerRecord, GitLogEntry } from "@/lib/transformer-types";

const TRANSFORMERS_DIR = path.join(process.cwd(), "data", "transformers");

function ensureTransformersDir() {
  if (!fs.existsSync(TRANSFORMERS_DIR)) {
    fs.mkdirSync(TRANSFORMERS_DIR, { recursive: true });
  }
}

function readManifest(dirPath: string): TransformerManifest | null {
  const manifestPath = path.join(dirPath, "transformer.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as TransformerManifest;
  } catch {
    return null;
  }
}

function readConfigValues(dirPath: string): Record<string, string | number | boolean | string[]> {
  const configPath = path.join(dirPath, "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, string | number | boolean | string[]>;
  } catch {
    return {};
  }
}

function getGitLog(dirPath: string): GitLogEntry[] {
  try {
    const raw = execSync(
      'git log --pretty=format:"%H|%h|%s|%ai" -- .',
      { cwd: dirPath, stdio: ["pipe", "pipe", "pipe"] }
    ).toString().trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => {
      const [hash, shortHash, message, date] = line.split("|");
      return { hash, shortHash, message, date };
    });
  } catch {
    return [];
  }
}

function isGitRepo(dirPath: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: dirPath, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function initGitRepo(dirPath: string) {
  execSync("git init", { cwd: dirPath, stdio: "pipe" });
  execSync("git add -A", { cwd: dirPath, stdio: "pipe" });
  execSync('git commit -m "Initial transformer"', { cwd: dirPath, stdio: "pipe" });
}

function gitCommit(dirPath: string, message: string) {
  try {
    execSync("git add -A", { cwd: dirPath, stdio: "pipe" });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: dirPath, stdio: "pipe" });
  } catch {
    // Nothing to commit or git not available — ignore
  }
}

class TransformerRegistry {
  getTransformersDir(): string {
    ensureTransformersDir();
    return TRANSFORMERS_DIR;
  }

  listTransformers(): TransformerRecord[] {
    ensureTransformersDir();
    const entries = fs.readdirSync(TRANSFORMERS_DIR, { withFileTypes: true });
    const records: TransformerRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(TRANSFORMERS_DIR, entry.name);
      const manifest = readManifest(dirPath);
      if (!manifest) continue;
      records.push({
        ...manifest,
        status: manifest.enabled ? "active" : "disabled",
        dirPath,
        configValues: readConfigValues(dirPath),
      });
    }
    return records;
  }

  getTransformer(id: string, includeGitLog = false): TransformerRecord | null {
    ensureTransformersDir();
    const dirPath = path.join(TRANSFORMERS_DIR, id);
    if (!fs.existsSync(dirPath)) return null;
    const manifest = readManifest(dirPath);
    if (!manifest) return null;
    const record: TransformerRecord = {
      ...manifest,
      status: manifest.enabled ? "active" : "disabled",
      dirPath,
      configValues: readConfigValues(dirPath),
    };
    if (includeGitLog) {
      record.gitLog = getGitLog(dirPath);
    }
    return record;
  }

  createTransformer(manifest: TransformerManifest): { id: string; dirPath: string } {
    ensureTransformersDir();
    const dirPath = path.join(TRANSFORMERS_DIR, manifest.id);
    if (fs.existsSync(dirPath)) {
      throw new Error(`Transformer with id "${manifest.id}" already exists`);
    }
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(
      path.join(dirPath, "transformer.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );
    try {
      initGitRepo(dirPath);
    } catch {
      // Git not available in this environment — skip
    }
    return { id: manifest.id, dirPath };
  }

  updateManifest(id: string, partial: Partial<TransformerManifest>): TransformerRecord {
    const dirPath = path.join(TRANSFORMERS_DIR, id);
    if (!fs.existsSync(dirPath)) throw new Error(`Transformer "${id}" not found`);
    const existing = readManifest(dirPath);
    if (!existing) throw new Error(`Manifest for transformer "${id}" is missing or corrupt`);
    const updated: TransformerManifest = { ...existing, ...partial };
    fs.writeFileSync(
      path.join(dirPath, "transformer.json"),
      JSON.stringify(updated, null, 2),
      "utf-8"
    );
    gitCommit(dirPath, "Update manifest");
    return {
      ...updated,
      status: updated.enabled ? "active" : "disabled",
      dirPath,
      configValues: readConfigValues(dirPath),
    };
  }

  updateConfig(id: string, configValues: Record<string, unknown>): void {
    const dirPath = path.join(TRANSFORMERS_DIR, id);
    if (!fs.existsSync(dirPath)) throw new Error(`Transformer "${id}" not found`);
    const existing = readConfigValues(dirPath);
    const merged = { ...existing, ...configValues };
    fs.writeFileSync(
      path.join(dirPath, "config.json"),
      JSON.stringify(merged, null, 2),
      "utf-8"
    );
    gitCommit(dirPath, "Update config");
  }

  toggleEnabled(id: string): boolean {
    const dirPath = path.join(TRANSFORMERS_DIR, id);
    if (!fs.existsSync(dirPath)) throw new Error(`Transformer "${id}" not found`);
    const manifest = readManifest(dirPath);
    if (!manifest) throw new Error(`Manifest for transformer "${id}" is missing or corrupt`);
    manifest.enabled = !manifest.enabled;
    fs.writeFileSync(
      path.join(dirPath, "transformer.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );
    gitCommit(dirPath, manifest.enabled ? "Enable transformer" : "Disable transformer");
    return manifest.enabled;
  }

  deleteTransformer(id: string): void {
    const dirPath = path.join(TRANSFORMERS_DIR, id);
    if (!fs.existsSync(dirPath)) throw new Error(`Transformer "${id}" not found`);
    fs.rmSync(dirPath, { recursive: true, force: true });
  }

  gitRollback(id: string, hash: string): void {
    const dirPath = path.join(TRANSFORMERS_DIR, id);
    if (!fs.existsSync(dirPath)) throw new Error(`Transformer "${id}" not found`);
    if (!isGitRepo(dirPath)) throw new Error(`Transformer "${id}" has no git history`);
    execSync(`git checkout ${hash} -- .`, { cwd: dirPath, stdio: "pipe" });
    gitCommit(dirPath, `Rollback to ${hash}`);
  }
}

export const transformerRegistry = new TransformerRegistry();

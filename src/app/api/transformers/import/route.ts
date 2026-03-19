import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUserAdmin } from "@/lib/claude-db";
import { transformerRegistry } from "@/lib/transformer-registry";
import fs from "fs";
import path from "path";

async function requireAdmin(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await isUserAdmin(session.user.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

/**
 * POST /api/transformers/import
 * Imports a transformer from a tar.gz upload.
 * Expects multipart/form-data with a "file" field.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".tar.gz") && !file.name.endsWith(".tgz")) {
      return NextResponse.json({ error: "File must be a .tar.gz archive" }, { status: 400 });
    }

    // Reject archives larger than 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Archive must be smaller than 10MB" }, { status: 400 });
    }

    const { execFileSync } = await import("child_process");
    const { tmpdir } = await import("os");
    const tmpFile = path.join(tmpdir(), `transformer-import-${Date.now()}.tar.gz`);
    const tmpExtractDir = path.join(tmpdir(), `transformer-extract-${Date.now()}`);

    // Write uploaded file to tmp
    const bytes = await file.arrayBuffer();
    fs.writeFileSync(tmpFile, Buffer.from(bytes));

    // Extract to temp dir
    fs.mkdirSync(tmpExtractDir, { recursive: true });
    try {
      execFileSync("tar", ["-xzf", tmpFile, "-C", tmpExtractDir], { stdio: "pipe" });
    } catch {
      fs.unlinkSync(tmpFile);
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });
      return NextResponse.json({ error: "Failed to extract archive" }, { status: 400 });
    }
    fs.unlinkSync(tmpFile);

    // Verify no extracted path escapes the temp directory (tar can contain ../ or absolute paths)
    const allExtracted = fs.readdirSync(tmpExtractDir, { recursive: true }) as string[];
    for (const entry of allExtracted) {
      const resolved = path.resolve(tmpExtractDir, String(entry));
      if (!resolved.startsWith(tmpExtractDir + path.sep) && resolved !== tmpExtractDir) {
        fs.rmSync(tmpExtractDir, { recursive: true, force: true });
        return NextResponse.json({ error: "Archive contains path traversal" }, { status: 400 });
      }
    }

    // Find the transformer directory (should be the only top-level dir)
    const entries = fs.readdirSync(tmpExtractDir);
    const transformerDir = entries.find((e) => {
      const fullPath = path.join(tmpExtractDir, e);
      return fs.statSync(fullPath).isDirectory();
    });

    if (!transformerDir) {
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });
      return NextResponse.json({ error: "Archive must contain a transformer directory" }, { status: 400 });
    }

    const extractedPath = path.join(tmpExtractDir, transformerDir);

    // Validate manifest
    const manifestPath = path.join(extractedPath, "transformer.json");
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });
      return NextResponse.json({ error: "Archive missing transformer.json manifest" }, { status: 400 });
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    } catch {
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });
      return NextResponse.json({ error: "Invalid transformer.json" }, { status: 400 });
    }

    const id = (manifest.id as string) || transformerDir;
    const transformersDir = transformerRegistry.getTransformersDir?.() ?? path.join(process.cwd(), "data", "transformers");
    const destPath = path.join(transformersDir, id);

    if (fs.existsSync(destPath)) {
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });
      return NextResponse.json({ error: `Transformer "${id}" already exists. Delete it first to re-import.` }, { status: 409 });
    }

    // Move to transformers dir
    fs.mkdirSync(transformersDir, { recursive: true });
    fs.renameSync(extractedPath, destPath);
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });

    return NextResponse.json({ id, ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

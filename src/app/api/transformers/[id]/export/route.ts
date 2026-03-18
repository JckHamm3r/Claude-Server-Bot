import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUserAdmin } from "@/lib/claude-db";
import { transformerRegistry } from "@/lib/transformer-registry";
import fs from "fs";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";

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
 * GET /api/transformers/:id/export
 * Exports a transformer as a tar.gz archive (using native tar).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const transformer = transformerRegistry.getTransformer(params.id);
  if (!transformer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { execSync } = await import("child_process");
    const { tmpdir } = await import("os");
    const tmpFile = path.join(tmpdir(), `transformer-${params.id}-${Date.now()}.tar.gz`);

    // Create archive excluding .git directory
    execSync(
      `tar --exclude='.git' -czf "${tmpFile}" -C "${path.dirname(transformer.dirPath)}" "${params.id}"`,
      { stdio: "pipe" }
    );

    const buffer = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="transformer-${params.id}.tar.gz"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Suppress unused import lint warning
void createWriteStream;
void pipeline;

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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const transformer = transformerRegistry.getTransformer(params.id);
  if (!transformer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const linesParam = request.nextUrl.searchParams.get("lines");
  const maxLines = linesParam ? Math.max(1, Math.min(10000, parseInt(linesParam, 10) || 200)) : 200;

  try {
    const logsDir = path.join(transformer.dirPath, "logs");

    if (!fs.existsSync(logsDir)) {
      return NextResponse.json({ logs: [], transformer_id: params.id });
    }

    const logFiles = fs
      .readdirSync(logsDir)
      .filter((f) => f.endsWith(".log"))
      .sort(); // chronological by filename convention

    if (logFiles.length === 0) {
      return NextResponse.json({ logs: [], transformer_id: params.id });
    }

    const allLines: string[] = [];
    for (const file of logFiles) {
      const content = fs.readFileSync(path.join(logsDir, file), "utf-8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");
      allLines.push(...lines);
    }

    const tail = allLines.slice(-maxLines);
    return NextResponse.json({ logs: tail, transformer_id: params.id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

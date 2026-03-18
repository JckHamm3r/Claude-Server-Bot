import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUserAdmin } from "@/lib/claude-db";
import { transformerRegistry } from "@/lib/transformer-registry";
import { validateManifest } from "@/lib/transformer-types";
import type { TransformerManifest } from "@/lib/transformer-types";

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

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const transformers = transformerRegistry.listTransformers();
    return NextResponse.json({ transformers });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: { manifest?: TransformerManifest };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.manifest) {
    return NextResponse.json({ error: "Missing manifest" }, { status: 400 });
  }

  const validation = validateManifest(body.manifest);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 422 });
  }

  try {
    const result = transformerRegistry.createTransformer(body.manifest);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("already exists")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

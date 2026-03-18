import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUserAdmin } from "@/lib/claude-db";
import { transformerRegistry } from "@/lib/transformer-registry";
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

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const transformer = transformerRegistry.getTransformer(params.id, true);
    if (!transformer) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ transformer });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: { manifest?: Partial<TransformerManifest>; configValues?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = transformerRegistry.getTransformer(params.id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    if (body.manifest) {
      transformerRegistry.updateManifest(params.id, body.manifest);
    }
    if (body.configValues) {
      transformerRegistry.updateConfig(params.id, body.configValues);
    }
    const updated = transformerRegistry.getTransformer(params.id, false);
    return NextResponse.json({ transformer: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const existing = transformerRegistry.getTransformer(params.id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    transformerRegistry.deleteTransformer(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

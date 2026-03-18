import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUserAdmin } from "@/lib/claude-db";
import { transformerRegistry } from "@/lib/transformer-registry";

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

export async function POST(
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
    const enabled = transformerRegistry.toggleEnabled(params.id);
    return NextResponse.json({ enabled });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

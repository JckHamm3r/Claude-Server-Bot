import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { dbGet } from "@/lib/db";
import { getUpload } from "@/lib/claude-db";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR ?? "./data";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const upload = await getUpload(id);
  if (!upload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sessionCheck = await dbGet<{ created_by: string }>("SELECT created_by FROM sessions WHERE id = ?", [upload.session_id]);
  if (!sessionCheck || sessionCheck.created_by !== token.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const filePath = path.join(DATA_DIR, "uploads", upload.session_id, upload.stored_name);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const safeName = upload.original_name.replace(/[^\w.\-]/g, '_');
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": upload.mime_type,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

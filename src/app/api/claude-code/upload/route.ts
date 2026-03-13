import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import db from "@/lib/db";
import { createUpload, getSessionUploads } from "@/lib/claude-db";
import { getAppSetting } from "@/lib/app-settings";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const DATA_DIR = process.env.DATA_DIR ?? "./data";

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const sessionId = formData.get("sessionId") as string | null;

    if (!file || !sessionId) {
      return NextResponse.json({ error: "Missing file or sessionId" }, { status: 400 });
    }

    const session = db.prepare("SELECT created_by FROM sessions WHERE id = ?").get(sessionId) as { created_by: string } | undefined;
    if (!session || session.created_by !== token.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const maxSize = parseInt(getAppSetting("upload_max_size_bytes", "10485760"), 10);

    // Explicit image MIME type support
    const allowedImageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    const isImage = allowedImageTypes.includes(file.type);

    // Image-specific size limit (20MB for images)
    const effectiveMaxSize = isImage ? Math.max(maxSize, 20 * 1024 * 1024) : maxSize;
    if (file.size > effectiveMaxSize) {
      return NextResponse.json({ error: `File too large. Maximum size is ${Math.round(effectiveMaxSize / 1024 / 1024)}MB.` }, { status: 413 });
    }

    const id = crypto.randomUUID();
    const ext = path.extname(file.name) || "";
    const storedName = `${id}${ext}`;
    const uploadDir = path.join(DATA_DIR, "uploads", sessionId);
    fs.mkdirSync(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(uploadDir, storedName);
    fs.writeFileSync(filePath, buffer);

    const upload = createUpload({
      id,
      sessionId,
      originalName: file.name,
      storedName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      uploadedBy: token.email as string,
    });

    return NextResponse.json({
      id: upload.id,
      filename: upload.stored_name,
      originalName: upload.original_name,
      size: upload.size_bytes,
      mimeType: upload.mime_type,
      url: `/api/claude-code/upload/${upload.id}`,
    });
  } catch (err) {
    console.error("[upload] Error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const session = db.prepare("SELECT created_by FROM sessions WHERE id = ?").get(sessionId) as { created_by: string } | undefined;
  if (!session || session.created_by !== token.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const uploads = getSessionUploads(sessionId);
  return NextResponse.json({ uploads });
}

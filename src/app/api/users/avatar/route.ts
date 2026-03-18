import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbRun } from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import crypto from "crypto";
import { logActivity } from "@/lib/activity-log";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = session.user.email;
    const contentType = req.headers.get("content-type");

    let avatarUrl: string | null = null;

    if (contentType?.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      if (file.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: "File size must be less than 2MB" }, { status: 400 });
      }

      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "File must be an image" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      
      const hash = crypto.createHash("md5").update(email).digest("hex");
      const ext = file.name.split(".").pop() || "png";
      const filename = `user-${hash}.${ext}`;
      
      const avatarsDir = join(process.cwd(), "public", "avatars");
      await mkdir(avatarsDir, { recursive: true });
      
      const filepath = join(avatarsDir, filename);
      await writeFile(filepath, buffer);
      
      avatarUrl = `/avatars/${filename}`;
    } else {
      const body = await req.json();
      const { avatarUrl: url } = body;

      if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "Invalid avatar URL" }, { status: 400 });
      }

      try {
        const urlObj = new URL(url);
        if (!["http:", "https:"].includes(urlObj.protocol)) {
          return NextResponse.json({ error: "Invalid URL protocol" }, { status: 400 });
        }

        const response = await fetch(url, { method: "HEAD" });
        if (!response.ok) {
          return NextResponse.json({ error: "Unable to access avatar URL" }, { status: 400 });
        }

        const contentType = response.headers.get("content-type");
        if (!contentType?.startsWith("image/")) {
          return NextResponse.json({ error: "URL does not point to an image" }, { status: 400 });
        }

        avatarUrl = url;
      } catch {
        return NextResponse.json({ error: "Invalid or inaccessible URL" }, { status: 400 });
      }
    }

    await dbRun("UPDATE users SET avatar_url = ? WHERE email = ?", [avatarUrl, email]);

    await logActivity("user_avatar_changed", email);

    return NextResponse.json({ avatarUrl });
  } catch (error) {
    console.error("[avatar] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { transformerRegistry } from "@/lib/transformer-registry";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/transformers/theme.css
 * Returns concatenated CSS from all enabled theme transformers.
 * Loaded via <link> in the root layout for live theme application.
 */
export async function GET() {
  try {
    const themeTransformers = transformerRegistry
      .listTransformers()
      .filter((t) => t.type === "theme" && t.enabled && t.status !== "error");

    const cssParts: string[] = [];

    for (const transformer of themeTransformers) {
      const entryFile = transformer.entry ?? "theme.css";
      const cssPath = path.join(transformer.dirPath, entryFile);
      if (fs.existsSync(cssPath)) {
        try {
          const css = fs.readFileSync(cssPath, "utf-8").trim();
          if (css) {
            cssParts.push(`/* Transformer: ${transformer.name} (${transformer.id}) */\n${css}`);
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    const combined = cssParts.join("\n\n");

    return new NextResponse(combined, {
      status: 200,
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[transformers/theme.css] Error:", err);
    return new NextResponse("/* Error loading transformer themes */", {
      status: 200,
      headers: { "Content-Type": "text/css; charset=utf-8" },
    });
  }
}

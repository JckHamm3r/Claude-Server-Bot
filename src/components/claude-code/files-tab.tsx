"use client";

import { useState } from "react";
import { FileBrowserSidebar } from "./file-browser-sidebar";
import { FileViewer } from "./file-viewer";

export function FilesTab() {
  const [activeFile, setActiveFile] = useState<string | null>(null);

  return (
    <div className="flex h-full overflow-hidden">
      <FileBrowserSidebar
        activeFile={activeFile}
        onOpenFile={setActiveFile}
      />
      <FileViewer
        filePath={activeFile}
        onClose={() => setActiveFile(null)}
      />
    </div>
  );
}

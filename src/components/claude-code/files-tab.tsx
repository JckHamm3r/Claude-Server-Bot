"use client";

import { useState, useCallback } from "react";
import { FileBrowserSidebar } from "./file-browser-sidebar";
import { FileViewer } from "./file-viewer";

export function FilesTab() {
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const handleFileDeleted = useCallback((deletedPath: string) => {
    setActiveFile((current) => {
      if (!current) return current;
      // Clear if the deleted path IS the active file, or is a parent directory of it
      if (current === deletedPath || current.startsWith(deletedPath + "/")) {
        return null;
      }
      return current;
    });
  }, []);

  const handleFileRenamed = useCallback((oldPath: string, newPath: string) => {
    setActiveFile((current) => {
      if (!current) return current;
      if (current === oldPath) return newPath;
      if (current.startsWith(oldPath + "/")) return newPath + current.slice(oldPath.length);
      return current;
    });
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      <FileBrowserSidebar
        activeFile={activeFile}
        onOpenFile={setActiveFile}
        onFileDeleted={handleFileDeleted}
        onFileRenamed={handleFileRenamed}
      />
      <FileViewer
        filePath={activeFile}
        onClose={() => setActiveFile(null)}
        onFileDeleted={handleFileDeleted}
      />
    </div>
  );
}

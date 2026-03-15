# File Browser & Uploads

Browse project files on the server and upload files to attach to chat messages.

## Project File Browser

The file browser lets users explore the project directory tree from the UI. It reads the filesystem at `CLAUDE_PROJECT_ROOT` and returns directory listings.

**API:**
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/claude-code/files` | List files and directories in the project |

## File Uploads

Users can upload files during a chat session. Uploaded files are stored on disk and can be attached to messages sent to Claude.

**Constraints:**
- Maximum file size is controlled by the `upload_max_size_bytes` setting (default 10 MB).
- Uploads are associated with a specific session.

**API:**
| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/claude-code/upload` | Upload a file |
| GET | `/api/claude-code/upload` | List uploaded files |
| GET | `/api/claude-code/upload/[id]` | Retrieve a specific upload |

## Attachments in Chat

When composing a message, users can attach uploaded files. The attachment preview component shows thumbnails before sending. Attached files are included in the message metadata so Claude can reference them.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/claude-code/files/route.ts` | File browser API |
| `src/app/api/claude-code/upload/route.ts` | Upload API |
| `src/app/api/claude-code/upload/[id]/route.ts` | Individual upload retrieval |
| `src/components/claude-code/attachment-preview.tsx` | Attachment thumbnail preview |
| `src/components/claude-code/chat-input.tsx` | File attachment in message input |

## Database Table

| Table | Purpose |
|-------|---------|
| `uploads` | Upload records (session association, file path, metadata) |

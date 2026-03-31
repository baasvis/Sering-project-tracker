import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const resolvedUploads = path.resolve(uploadsDir);

interface MediaFile {
  filename: string;
  parentType: string;
  parentId: string;
}

// Delete a media file from disk, checking multiple possible locations.
// All paths are validated to be within the uploads directory (path traversal protection).
export async function deleteMediaFile(media: MediaFile): Promise<void> {
  const safeFilename = path.basename(media.filename);
  const candidates = [
    path.resolve(uploadsDir, safeFilename),
    path.resolve(uploadsDir, media.parentType, media.parentId, safeFilename),
    path.resolve(uploadsDir, 'misc', 'unknown', safeFilename),
  ];
  for (const filePath of candidates) {
    if (!filePath.startsWith(resolvedUploads)) continue;
    try {
      await fs.unlink(filePath);
      return;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') throw err;
    }
  }
}

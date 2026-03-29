const fs = require('fs').promises;
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads');
const resolvedUploads = path.resolve(uploadsDir);

// Delete a media file from disk, checking multiple possible locations.
// All paths are validated to be within the uploads directory (path traversal protection).
async function deleteMediaFile(media) {
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
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

module.exports = { deleteMediaFile };

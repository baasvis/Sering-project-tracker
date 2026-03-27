const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads');

// Delete a media file from disk, checking multiple possible locations
function deleteMediaFile(media) {
  const candidates = [
    path.join(uploadsDir, media.filename),
    path.join(uploadsDir, media.parentType, media.parentId, media.filename),
    path.join(uploadsDir, 'misc', 'unknown', media.filename)
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return;
    }
  }
}

module.exports = { deleteMediaFile };

const { google } = require('googleapis');

const drive = google.drive({
  version: 'v3',
  auth: process.env.GOOGLE_API_KEY
});

function buildDrivePreviewUrl(fileId, resourceKey) {
  const safeId = String(fileId || '').trim();
  if (!safeId) return '';

  // Most reliable Google Drive iframe format for video playback.
  const url = new URL(`https://drive.google.com/file/d/${safeId}/preview`);

  // Some files require resourcekey for embedded access after security updates.
  if (resourceKey) {
    url.searchParams.set('resourcekey', String(resourceKey));
  }

  // Keep simple UX params; Google Drive may ignore unsupported params.
  url.searchParams.set('usp', 'drivesdk');
  return url.toString();
}

async function scanDriveStructure(folderId) {
  const structure = [];

  async function listFolderContents(parentId, sectionName = '') {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, resourceKey, webViewLink)',
      pageSize: 1000
    });

    const videos = [];
    for (const file of res.data.files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        const subSection = await listFolderContents(file.id, file.name);
        if (subSection.videos.length > 0) structure.push(subSection);
      } else if (file.mimeType.startsWith('video/')) {
        const previewLink = buildDrivePreviewUrl(file.id, file.resourceKey);
        const previewFallback = buildDrivePreviewUrl(file.id, '');

        videos.push({
          name: file.name,
          preview: previewLink,
          previewFallback,
          fileId: file.id,
          resourceKey: file.resourceKey || '',
          webViewLink: file.webViewLink || ''
        });
      }
    }

    return { section: sectionName, videos };
  }

  const result = await listFolderContents(folderId);
  if (result.videos.length > 0) structure.push(result);

  return structure;
}

module.exports = scanDriveStructure;

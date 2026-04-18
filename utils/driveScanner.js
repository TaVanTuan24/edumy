const { google } = require('googleapis');

const drive = google.drive({
  version: 'v3',
  auth: process.env.GOOGLE_API_KEY
});

function buildDrivePreviewUrl(fileId, resourceKey) {
  const safeId = String(fileId || '').trim();
  if (!safeId) return '';

  const url = new URL(`https://drive.google.com/file/d/${safeId}/preview`);
  if (resourceKey) {
    url.searchParams.set('resourcekey', String(resourceKey));
  }
  url.searchParams.set('usp', 'drivesdk');
  return url.toString();
}

async function scanDriveStructure(folderId) {
  const sections = [];

  async function listFolderContents(parentId, sectionTitle = '') {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, resourceKey, webViewLink)',
      pageSize: 1000
    });

    const lessons = [];
    for (const file of res.data.files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        const nestedSection = await listFolderContents(file.id, file.name);
        if (nestedSection.lessons.length > 0) sections.push(nestedSection);
      } else if (file.mimeType.startsWith('video/')) {
        const videoUrl = buildDrivePreviewUrl(file.id, file.resourceKey);

        lessons.push({
          title: file.name,
          type: 'video',
          videoUrl,
          preview: videoUrl,
          refId: file.id,
          content: {
            videoUrl,
            resourceKey: file.resourceKey || '',
            webViewLink: file.webViewLink || ''
          }
        });
      }
    }

    return { title: sectionTitle, lessons };
  }

  const rootSection = await listFolderContents(folderId);
  if (rootSection.lessons.length > 0) sections.push(rootSection);

  return sections;
}

module.exports = scanDriveStructure;

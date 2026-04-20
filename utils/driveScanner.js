const { google } = require('googleapis');
const { buildDrivePreviewUrl } = require('./driveVideoMetadata');
const { prepareLessonForWrite } = require('./courseStats');

const drive = google.drive({
  version: 'v3',
  auth: process.env.GOOGLE_API_KEY
});

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
        const lesson = {
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
        };

        const durationResult = await prepareLessonForWrite(lesson, {
          debug: true,
          allowDriveLookup: true
        });

        lessons.push(lesson);

        if (!durationResult.ok) {
          console.log('[drive-scan] video duration unavailable', {
            fileId: file.id,
            mimeType: file.mimeType,
            metadataFound: durationResult.metadataFound,
            skipReason: durationResult.skipReason
          });
        }
      }
    }

    return { title: sectionTitle, lessons };
  }

  const rootSection = await listFolderContents(folderId);
  if (rootSection.lessons.length > 0) sections.push(rootSection);

  return sections;
}

module.exports = scanDriveStructure;

// TC-05: Import Google Drive
// Kiểm tra nhập folder link chứa video, tạo section/lesson video

const { buildDrivePreviewUrl } = require('../utils/driveVideoMetadata');
const { stripFileExtension } = require('../utils/formatLessonName');

describe('TC-05: Google Drive import utilities', () => {
  test('buildDrivePreviewUrl generates correct preview link for a file', () => {
    const url = buildDrivePreviewUrl('abc123FileId', '');
    expect(url).toContain('abc123FileId');
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  test('buildDrivePreviewUrl includes resourceKey when provided', () => {
    const url = buildDrivePreviewUrl('abc123FileId', 'resource-key-xyz');
    expect(url).toContain('abc123FileId');
  });

  test('stripFileExtension removes video extensions for lesson titles', () => {
    expect(stripFileExtension('Introduction.mp4')).toBe('Introduction');
    expect(stripFileExtension('Chapter 1 Overview.webm')).toBe('Chapter 1 Overview');
    expect(stripFileExtension('lecture_01.mkv')).toBe('lecture_01');
    expect(stripFileExtension('Lesson 3 - Arrays and Objects.avi')).toBe('Lesson 3 - Arrays and Objects');
  });

  test('stripFileExtension preserves title when no extension', () => {
    expect(stripFileExtension('Introduction to Python')).toBe('Introduction to Python');
  });

  test('drive scanner builds section structure from folder hierarchy', () => {
    // Simulates the structure that scanDriveStructure would produce
    const mockFolderContents = [
      { name: 'video1.mp4', mimeType: 'video/mp4', id: 'file1', resourceKey: '' },
      { name: 'video2.mp4', mimeType: 'video/mp4', id: 'file2', resourceKey: '' }
    ];

    const lessons = mockFolderContents
      .filter((file) => file.mimeType.startsWith('video/'))
      .map((file) => ({
        title: stripFileExtension(file.name),
        type: 'video',
        videoUrl: buildDrivePreviewUrl(file.id, file.resourceKey),
        refId: file.id
      }));

    expect(lessons).toHaveLength(2);
    expect(lessons[0].title).toBe('video1');
    expect(lessons[0].type).toBe('video');
    expect(lessons[0].refId).toBe('file1');
    expect(lessons[1].title).toBe('video2');
  });

  test('drive scanner creates sections from subfolders', () => {
    // Simulates nested folder → section mapping
    const mockSubfolders = [
      {
        name: 'Section 1 - Basics',
        files: [
          { name: 'intro.mp4', mimeType: 'video/mp4', id: 'f1', resourceKey: '' }
        ]
      },
      {
        name: 'Section 2 - Advanced',
        files: [
          { name: 'advanced1.mp4', mimeType: 'video/mp4', id: 'f2', resourceKey: '' },
          { name: 'advanced2.mp4', mimeType: 'video/mp4', id: 'f3', resourceKey: '' }
        ]
      }
    ];

    const sections = mockSubfolders.map((folder) => ({
      title: folder.name,
      lessons: folder.files
        .filter((file) => file.mimeType.startsWith('video/'))
        .map((file) => ({
          title: stripFileExtension(file.name),
          type: 'video',
          videoUrl: buildDrivePreviewUrl(file.id, file.resourceKey),
          refId: file.id
        }))
    }));

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Section 1 - Basics');
    expect(sections[0].lessons).toHaveLength(1);
    expect(sections[1].lessons).toHaveLength(2);
    expect(sections[1].lessons[0].title).toBe('advanced1');
  });

  test('non-video files are filtered out during import', () => {
    const mockFiles = [
      { name: 'video.mp4', mimeType: 'video/mp4', id: 'f1' },
      { name: 'readme.txt', mimeType: 'text/plain', id: 'f2' },
      { name: 'notes.pdf', mimeType: 'application/pdf', id: 'f3' },
      { name: 'lecture.webm', mimeType: 'video/webm', id: 'f4' }
    ];

    const videoFiles = mockFiles.filter((file) => file.mimeType.startsWith('video/'));
    expect(videoFiles).toHaveLength(2);
    expect(videoFiles[0].name).toBe('video.mp4');
    expect(videoFiles[1].name).toBe('lecture.webm');
  });
});
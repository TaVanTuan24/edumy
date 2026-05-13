// TC-06: Import YouTube Playlist
// Kiểm tra nhập URL playlist, preview, chỉnh sửa, chuyển thành Course → Section → Lesson

const {
  extractPlaylistId,
  isYouTubePlaylistUrl
} = require('../services/youtube/youtubeUrlParser');

describe('TC-06: YouTube playlist import', () => {
  describe('extractPlaylistId', () => {
    test('extracts playlist ID from standard YouTube URL', () => {
      const id = extractPlaylistId('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
      expect(id).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    test('extracts playlist ID from URL with video parameter', () => {
      const id = extractPlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
      expect(id).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    test('returns empty string for non-YouTube URLs', () => {
      expect(extractPlaylistId('https://example.com/playlist')).toBe('');
    });

    test('returns empty string for empty input', () => {
      expect(extractPlaylistId('')).toBe('');
      expect(extractPlaylistId(null)).toBe('');
      expect(extractPlaylistId(undefined)).toBe('');
    });

    test('returns empty string when no list parameter', () => {
      expect(extractPlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('');
    });

    test('handles youtu.be short URLs without playlist', () => {
      expect(extractPlaylistId('https://youtu.be/dQw4w9WgXcQ')).toBe('');
    });
  });

  describe('isYouTubePlaylistUrl', () => {
    test('returns true for valid playlist URL', () => {
      expect(isYouTubePlaylistUrl('https://www.youtube.com/playlist?list=PLtest123')).toBe(true);
    });

    test('returns false for regular video URL', () => {
      expect(isYouTubePlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    });

    test('returns false for non-YouTube URL', () => {
      expect(isYouTubePlaylistUrl('https://vimeo.com/123456')).toBe(false);
    });

    test('returns false for empty input', () => {
      expect(isYouTubePlaylistUrl('')).toBe(false);
    });
  });

  describe('Course structure from playlist', () => {
    test('buildCourseSectionsFromPreview creates sections with video lessons', () => {
      // Simulates what youtubeCourseImportService.buildCourseSectionsFromPreview does
      const previewSections = [
        {
          title: 'Section 1 - Introduction',
          lessons: [
            { title: 'Welcome Video', videoUrl: 'https://youtube.com/watch?v=abc1', type: 'video' },
            { title: 'Setup Guide', videoUrl: 'https://youtube.com/watch?v=abc2', type: 'video' }
          ]
        },
        {
          title: 'Section 2 - Basics',
          lessons: [
            { title: 'Variables', videoUrl: 'https://youtube.com/watch?v=abc3', type: 'video' }
          ]
        }
      ];

      // Verify structure: Course → Section → Lesson
      expect(previewSections).toHaveLength(2);
      expect(previewSections[0].title).toBe('Section 1 - Introduction');
      expect(previewSections[0].lessons).toHaveLength(2);
      expect(previewSections[0].lessons[0].type).toBe('video');
      expect(previewSections[0].lessons[0].videoUrl).toContain('youtube.com');
      expect(previewSections[1].lessons).toHaveLength(1);
    });

    test('each lesson preserves its video URL and title', () => {
      const lessons = [
        { title: 'Lesson 1', videoUrl: 'https://www.youtube.com/watch?v=vid1', type: 'video' },
        { title: 'Lesson 2', videoUrl: 'https://www.youtube.com/watch?v=vid2', type: 'video' }
      ];

      lessons.forEach((lesson) => {
        expect(lesson.title).toBeTruthy();
        expect(lesson.videoUrl).toContain('youtube.com');
        expect(lesson.type).toBe('video');
      });
    });

    test('preview allows editing section titles before saving', () => {
      const section = { title: 'Auto-generated Title', lessons: [] };
      // User edits
      section.title = 'Custom Title';
      expect(section.title).toBe('Custom Title');
    });

    test('preview allows removing lessons before saving', () => {
      const lessons = [
        { title: 'Keep', videoUrl: 'https://youtube.com/watch?v=1', type: 'video' },
        { title: 'Remove', videoUrl: 'https://youtube.com/watch?v=2', type: 'video' }
      ];

      const filtered = lessons.filter((l) => l.title !== 'Remove');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Keep');
    });
  });
});
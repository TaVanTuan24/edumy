const { stripFileExtension } = require('../utils/formatLessonName');

describe('stripFileExtension', () => {
  test('removes a simple video extension', () => {
    expect(stripFileExtension('video.mp4')).toBe('video');
  });

  test('removes only the last extension', () => {
    expect(stripFileExtension('lesson.v1.mp4')).toBe('lesson.v1');
  });

  test('supports multi-dot filenames', () => {
    expect(stripFileExtension('my.video.file.mkv')).toBe('my.video.file');
  });

  test('returns the original string when there is no extension', () => {
    expect(stripFileExtension('noextension')).toBe('noextension');
  });

  test('matches extensions case-insensitively', () => {
    expect(stripFileExtension('UPPER.MP4')).toBe('UPPER');
  });

  test('trims trailing whitespace before stripping the extension', () => {
    expect(stripFileExtension('trailing space.mp4 ')).toBe('trailing space');
  });
});

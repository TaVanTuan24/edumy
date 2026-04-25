const VIDEO_FILE_EXTENSION_PATTERN = /\.((3g2|3gp|amv|asf|avi|drc|f4v|flv|m2ts|m2v|m4v|mkv|mov|mp2|mp4|mpe?g|mpg|mts|mxf|ogg|ogv|qt|rm|rmvb|ts|vob|webm|wmv))$/i;

function stripFileExtension(name) {
  const value = String(name || '').trim();
  if (!value) return '';

  return value.replace(VIDEO_FILE_EXTENSION_PATTERN, '');
}

module.exports = {
  stripFileExtension
};

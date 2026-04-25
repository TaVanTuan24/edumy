const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;
const DEFAULT_PDF_UPLOAD_FOLDER = 'CourseLessonPdfs';

function imageFileFilter(_req, file, cb) {
  const mimeType = String(file && file.mimetype || '').toLowerCase();
  if (/^image\/(jpe?g|png)$/i.test(mimeType)) {
    return cb(null, true);
  }

  return cb(new Error('Only JPG and PNG image uploads are allowed.'));
}

function isPdfFile(file) {
  const mimeType = String(file && file.mimetype || '').toLowerCase();
  const ext = String(path.extname(String(file && file.originalname || '')) || '').toLowerCase();
  return mimeType === 'application/pdf' && ext === '.pdf';
}

function pdfFileFilter(_req, file, cb) {
  if (isPdfFile(file)) {
    return cb(null, true);
  }

  return cb(new Error('Only PDF uploads are allowed.'));
}

function getPdfUploadOptions(options = {}) {
  const folder = String(options.folder || DEFAULT_PDF_UPLOAD_FOLDER).trim() || DEFAULT_PDF_UPLOAD_FOLDER;
  const uploadOptions = {
    folder,
    resource_type: 'raw',
    type: 'upload',
    access_mode: 'public',
    format: 'pdf',
    use_filename: false,
    unique_filename: true,
    overwrite: false
  };

  if (options.publicId) {
    uploadOptions.public_id = String(options.publicId).trim();
  }

  return uploadOptions;
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'CourseImg',
    allowedFormats: ['jpeg', 'png', 'jpg']
  }
});

module.exports = {
  cloudinary,
  storage,
  imageFileFilter,
  pdfFileFilter,
  getPdfUploadOptions,
  isPdfFile,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  DEFAULT_PDF_UPLOAD_FOLDER
};

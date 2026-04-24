const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

function imageFileFilter(_req, file, cb) {
  const mimeType = String(file && file.mimetype || '').toLowerCase();
  if (/^image\/(jpe?g|png)$/i.test(mimeType)) {
    return cb(null, true);
  }

  return cb(new Error('Only JPG and PNG image uploads are allowed.'));
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
  MAX_IMAGE_UPLOAD_BYTES
};

const {
  normalizeStoredPdfUrl,
  isPublicCloudinaryRawUploadUrl,
  isLikelyRestrictedCloudinaryPdfUrl,
  getUploadedCloudinaryPdfUrl,
  buildPdfDeliveryErrorMessage
} = require('../utils/cloudinaryPdf');
const {
  getPdfUploadOptions,
  DEFAULT_PDF_UPLOAD_FOLDER
} = require('../config/cloudinary');

describe('cloudinary PDF helpers', () => {
  test('getPdfUploadOptions enforces public raw upload delivery', () => {
    expect(getPdfUploadOptions({ publicId: 'lesson-doc' })).toEqual({
      folder: DEFAULT_PDF_UPLOAD_FOLDER,
      resource_type: 'raw',
      type: 'upload',
      access_mode: 'public',
      format: 'pdf',
      use_filename: false,
      unique_filename: true,
      overwrite: false,
      public_id: 'lesson-doc'
    });
  });

  test('normalizeStoredPdfUrl upgrades http without rewriting delivery type', () => {
    expect(
      normalizeStoredPdfUrl('http://res.cloudinary.com/demo/raw/private/v1/folder/doc.pdf')
    ).toBe('https://res.cloudinary.com/demo/raw/private/v1/folder/doc.pdf');
  });

  test('isPublicCloudinaryRawUploadUrl accepts only raw upload secure urls', () => {
    expect(
      isPublicCloudinaryRawUploadUrl('https://res.cloudinary.com/demo/raw/upload/v123/folder/doc.pdf')
    ).toBe(true);
    expect(
      isPublicCloudinaryRawUploadUrl('https://res.cloudinary.com/demo/raw/private/v123/folder/doc.pdf')
    ).toBe(false);
  });

  test('getUploadedCloudinaryPdfUrl uses secure_url only', () => {
    expect(getUploadedCloudinaryPdfUrl({
      secure_url: 'https://res.cloudinary.com/demo/raw/upload/v123/folder/doc.pdf',
      url: 'http://res.cloudinary.com/demo/raw/upload/v123/folder/doc.pdf'
    })).toBe('https://res.cloudinary.com/demo/raw/upload/v123/folder/doc.pdf');

    expect(getUploadedCloudinaryPdfUrl({
      url: 'https://res.cloudinary.com/demo/raw/upload/v123/folder/doc.pdf'
    })).toBe('');
  });

  test('restricted urls and delivery errors produce clear warnings', () => {
    expect(
      isLikelyRestrictedCloudinaryPdfUrl('https://res.cloudinary.com/demo/raw/authenticated/v123/folder/doc.pdf')
    ).toBe(true);
    expect(buildPdfDeliveryErrorMessage(401)).toBe(
      'PDF uploaded but not publicly accessible. Please check Cloudinary settings.'
    );
    expect(buildPdfDeliveryErrorMessage(404)).toBe(
      'PDF uploaded, but the public Cloudinary URL returned HTTP 404.'
    );
  });
});

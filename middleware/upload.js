const fs = require('fs');
const path = require('path');
const multer = require('multer');

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4']);
const MIME_TO_EXTENSION = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
};

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const serviceStorage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadDir = ensureDirectory(path.join(__dirname, '../public/uploads/services'));
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, safeName);
  },
});

const galleryStorage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadDir = ensureDirectory(path.join(__dirname, '../public/uploads/gallery'));
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, safeName);
  },
});

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function imageFileFilter(req, file, cb) {
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedExtension = MIME_TO_EXTENSION[file.mimetype];

  if (!IMAGE_EXTENSIONS.has(extension) || !expectedExtension || extension !== expectedExtension) {
    return cb(new Error('Недоступный тип файла. Используйте JPG, PNG или WEBP.'));
  }

  cb(null, true);
}

function galleryFileFilter(req, file, cb) {
  if (file.fieldname === 'poster') {
    return imageFileFilter(req, file, cb);
  }
  return fileFilter(req, file, cb);
}

function fileFilter(req, file, cb) {
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedExtension = MIME_TO_EXTENSION[file.mimetype];

  if (!ALLOWED_EXTENSIONS.has(extension) || !expectedExtension || extension !== expectedExtension) {
    return cb(new Error('Недоступный тип файла. Используйте JPG, PNG, WEBP или MP4.'));
  }

  cb(null, true);
}

const uploadServiceImage = multer({
  storage: serviceStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadGalleryMedia = multer({
  storage: galleryStorage,
  fileFilter: galleryFileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});

module.exports = { uploadServiceImage, uploadGalleryMedia };

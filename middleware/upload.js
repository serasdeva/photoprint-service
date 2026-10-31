const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

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
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadGalleryMedia = multer({
  storage: galleryStorage,
  fileFilter: galleryFileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});

// multer задаёт один лимит на весь запрос, а постер — обычная картинка: 25 МБ ему не нужны.
const POSTER_MAX_BYTES = 8 * 1024 * 1024;

function posterWithinLimit(req) {
  const poster = req.files && req.files.poster && req.files.poster[0];
  return !poster || poster.size <= POSTER_MAX_BYTES;
}

const PROCESSABLE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MEDIA_MAX_EDGE = 1920;
const POSTER_MAX_EDGE = 1280;
const WEBP_QUALITY = 82;

function withExtension(filePath, extension) {
  return filePath.replace(/\.[^.]+$/, '') + extension;
}

/**
 * Посетителю не нужен оригинал на 25 МБ и 6000 px: картинки поворачиваются по EXIF,
 * ужимаются до maxEdge по длинной стороне и конвертируются в WebP. Видео не трогаем.
 */
async function processImageFile(file, maxEdge) {
  const target = withExtension(file.path, '.webp');
  // Если исходник уже .webp, пишем во временный файл — нельзя писать в читаемый файл.
  const outPath = target === file.path ? `${target}.tmp` : target;

  let info;
  try {
    info = await sharp(file.path)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(outPath);
  } catch (error) {
    // Битый файл: убираем возможный недописанный результат, оригинал удалит вызывающая сторона.
    fs.rmSync(outPath, { force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }

  if (outPath !== target) {
    fs.renameSync(outPath, target);
  }
  if (file.path !== target) {
    // Windows может держать файл открытым мгновение после записи — нужны ретраи.
    fs.rmSync(file.path, { force: true, maxRetries: 5, retryDelay: 100 });
  }

  file.path = target;
  file.filename = path.basename(target);
  file.mimetype = 'image/webp';
  file.size = info.size;
  file.width = info.width;
  file.height = info.height;
  return file;
}

async function processUploadedImages(req, options = {}) {
  const { mediaMaxEdge = MEDIA_MAX_EDGE, posterMaxEdge = POSTER_MAX_EDGE } = options;
  const files = [req.file, ...Object.values(req.files || {}).flat()].filter(
    (file) => file && file.path
  );

  for (const file of files) {
    if (!PROCESSABLE_MIME.has(file.mimetype)) {
      continue;
    }
    const maxEdge = file.fieldname === 'poster' ? posterMaxEdge : mediaMaxEdge;
    await processImageFile(file, maxEdge);
  }
}

module.exports = {
  uploadServiceImage,
  uploadGalleryMedia,
  POSTER_MAX_BYTES,
  posterWithinLimit,
  processUploadedImages,
};

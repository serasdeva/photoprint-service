const express = require('express');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { verifyCsrfAfterUpload } = require('../middleware/csrf');
const { saveAdminFormDraft } = require('../utils/adminFormDraft');
const {
  uploadServiceImage,
  uploadGalleryMedia,
  POSTER_MAX_BYTES,
  posterWithinLimit,
} = require('../middleware/upload');
const { loginPage, loginUser, logoutUser } = require('../controllers/authController');
const {
  renderDashboard,
  renderServicesPage,
  renderServiceForm,
  saveService,
  deleteService,
  renderGalleryPage,
  renderGalleryForm,
  saveGallery,
  deleteGallery,
  renderOrdersPage,
  renderOrderPage,
  exportOrdersCsv,
  updateOrderStatus,
  deleteOrder,
  renderSettingsPage,
  saveSettings,
  renderTelegramPage,
  saveTelegramSettings,
  sendTelegramTest,
} = require('../controllers/admin');

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    req.flash('error', 'Слишком много попыток входа. Попробуйте позже.');
    return res.redirect('/admin/login');
  },
});

function failUpload(req, res, message) {
  const section = req.path.startsWith('/gallery') ? 'gallery' : 'services';
  saveAdminFormDraft(req, section, req.params.id);
  req.flash('error', message);
  return res.redirect(
    req.params.id ? `/admin/${section}/${req.params.id}/edit` : `/admin/${section}/new`
  );
}

function handleUpload(uploadMiddleware, maxMb) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) {
        return next();
      }

      // У multer сообщение «File too large» английское и без цифры лимита.
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Файл больше ${maxMb} МБ — уменьшите его.`
          : err.message || 'Ошибка загрузки файла';
      return failUpload(req, res, message);
    });
  };
}

function rejectOversizedPoster(req, res, next) {
  if (posterWithinLimit(req)) {
    return next();
  }

  // multer уже записал файлы на диск, поэтому их нужно убрать.
  discardUploadedFile(req);
  return failUpload(
    req,
    res,
    `Постер больше ${POSTER_MAX_BYTES / (1024 * 1024)} МБ — уменьшите картинку.`
  );
}

function discardUploadedFile(req) {
  const uploadedFiles = [req.file, ...Object.values(req.files || {}).flat()].filter(
    (file) => file && file.path
  );

  uploadedFiles.forEach((file) => {
    fs.unlink(file.path, (error) => {
      if (error && error.code !== 'ENOENT') {
        console.error('Failed to remove rejected admin upload:', error);
      }
    });
  });
}

function validate(rules) {
  return [
    ...rules,
    (req, res, next) => {
      const errors = validationResult(req);
      if (errors.isEmpty()) {
        return next();
      }

      discardUploadedFile(req);
      const section = req.path.startsWith('/gallery') ? 'gallery' : 'services';
      saveAdminFormDraft(req, section, req.params.id);
      const validationMessage = errors
        .array()
        .map((item) => item.msg)
        .join(' ');
      const hasUpload = req.file || Object.values(req.files || {}).some((files) => files.length);
      req.flash(
        'error',
        hasUpload ? `${validationMessage} Выберите файл повторно.` : validationMessage
      );

      return res.redirect(
        req.params.id ? `/admin/${section}/${req.params.id}/edit` : `/admin/${section}/new`
      );
    },
  ];
}

const serviceRules = [
  body('title')
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Название услуги: от 2 до 120 символов.'),
  body('slug')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[a-z0-9-]+$/i)
    .withMessage('Slug: только латиница, цифры и дефис.'),
  body('price').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Цена: число от 0.'),
  body('order')
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 9999 })
    .withMessage('Порядок: целое число от 0 до 9999.'),
  body('priceUnit')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 30 })
    .withMessage('Единица измерения: до 30 символов.'),
  body('icon')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[a-z0-9 -]*$/i)
    .withMessage('Иконка: допустимы только латиница, цифры, пробел и дефис.'),
  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Описание: до 5000 символов.'),
];

const galleryRules = [
  body('title')
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Название: от 2 до 120 символов.'),
  body('category')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[A-Za-zА-Яа-я0-9 _-]+$/)
    .withMessage('Категория: буквы, цифры, пробел, - и _.'),
  body('type')
    .optional({ checkFalsy: true })
    .isIn(['image', 'video'])
    .withMessage('Тип медиа: image или video.'),
  body('order')
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 9999 })
    .withMessage('Порядок: целое число от 0 до 9999.'),
  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Описание: до 2000 символов.'),
];

router.get('/login', asyncHandler(loginPage));
router.post('/login', authLimiter, asyncHandler(loginUser));
router.post('/logout', asyncHandler(logoutUser));

router.use(requireAuth);

router.get('/', asyncHandler(renderDashboard));

router.get('/services', asyncHandler(renderServicesPage));
router.get('/services/new', asyncHandler(renderServiceForm));
router.get('/services/:id/edit', asyncHandler(renderServiceForm));
router.post(
  '/services',
  handleUpload(uploadServiceImage.single('image'), 5),
  verifyCsrfAfterUpload,
  validate(serviceRules),
  asyncHandler(saveService)
);
router.post(
  '/services/:id',
  handleUpload(uploadServiceImage.single('image'), 5),
  verifyCsrfAfterUpload,
  validate(serviceRules),
  asyncHandler(saveService)
);
router.post('/services/:id/delete', asyncHandler(deleteService));

const uploadGalleryMediaFields = uploadGalleryMedia.fields([
  { name: 'media', maxCount: 1 },
  { name: 'poster', maxCount: 1 },
]);

router.get('/gallery', asyncHandler(renderGalleryPage));
router.get('/gallery/new', asyncHandler(renderGalleryForm));
router.get('/gallery/:id/edit', asyncHandler(renderGalleryForm));
router.post(
  '/gallery',
  handleUpload(uploadGalleryMediaFields, 25),
  rejectOversizedPoster,
  verifyCsrfAfterUpload,
  validate(galleryRules),
  asyncHandler(saveGallery)
);
router.post(
  '/gallery/:id',
  handleUpload(uploadGalleryMediaFields, 25),
  rejectOversizedPoster,
  verifyCsrfAfterUpload,
  validate(galleryRules),
  asyncHandler(saveGallery)
);
router.post('/gallery/:id/delete', asyncHandler(deleteGallery));

router.get('/orders', asyncHandler(renderOrdersPage));
// GET-маршрут без тела: CSRF не нужен, доступ закрывает requireAuth выше.
router.get('/orders/export', asyncHandler(exportOrdersCsv));
// Ниже /orders/export, иначе Express принял бы «export» за id заявки.
router.get('/orders/:id', asyncHandler(renderOrderPage));
router.post('/orders/:id/status', asyncHandler(updateOrderStatus));
router.patch('/orders/:id/status', asyncHandler(updateOrderStatus));
router.post('/orders/:id/delete', asyncHandler(deleteOrder));

router.get('/settings', asyncHandler(renderSettingsPage));
router.post('/settings', asyncHandler(saveSettings));

router.get('/settings/telegram', asyncHandler(renderTelegramPage));
router.post('/settings/telegram', asyncHandler(saveTelegramSettings));
router.post('/settings/telegram/test', asyncHandler(sendTelegramTest));

module.exports = router;

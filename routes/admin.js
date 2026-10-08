const express = require('express');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { verifyCsrfAfterUpload } = require('../middleware/csrf');
const { uploadServiceImage, uploadGalleryMedia } = require('../middleware/upload');
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
  updateOrderStatus,
  deleteOrder,
  renderSettingsPage,
  saveSettings,
} = require('../controllers/adminController');

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

function handleUpload(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) {
        return next();
      }

      const message = err.message || 'Ошибка загрузки файла';
      const section = req.baseUrl.includes('gallery') ? 'gallery' : 'services';
      req.flash('error', message);
      return res.redirect(
        req.params.id ? `/admin/${section}/${req.params.id}/edit` : `/admin/${section}/new`
      );
    });
  };
}

function discardUploadedFile(req) {
  if (req.file && req.file.path) {
    fs.unlink(req.file.path, () => {});
  }
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
      req.flash(
        'error',
        errors
          .array()
          .map((item) => item.msg)
          .join(' ')
      );

      const section = req.baseUrl.includes('gallery') ? 'gallery' : 'services';
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
  handleUpload(uploadServiceImage.single('image')),
  verifyCsrfAfterUpload,
  validate(serviceRules),
  asyncHandler(saveService)
);
router.post(
  '/services/:id',
  handleUpload(uploadServiceImage.single('image')),
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
  handleUpload(uploadGalleryMediaFields),
  verifyCsrfAfterUpload,
  validate(galleryRules),
  asyncHandler(saveGallery)
);
router.post(
  '/gallery/:id',
  handleUpload(uploadGalleryMediaFields),
  verifyCsrfAfterUpload,
  validate(galleryRules),
  asyncHandler(saveGallery)
);
router.post('/gallery/:id/delete', asyncHandler(deleteGallery));

router.get('/orders', asyncHandler(renderOrdersPage));
router.post('/orders/:id/status', asyncHandler(updateOrderStatus));
router.patch('/orders/:id/status', asyncHandler(updateOrderStatus));
router.post('/orders/:id/delete', asyncHandler(deleteOrder));

router.get('/settings', asyncHandler(renderSettingsPage));
router.post('/settings', asyncHandler(saveSettings));

module.exports = router;

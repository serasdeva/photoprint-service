const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const { getServiceApi } = require('../controllers/serviceController');
const { getGalleryApi } = require('../controllers/galleryController');
const { createOrder } = require('../controllers/orderController');

const router = express.Router();
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Слишком много заявок. Попробуйте позже.',
});

router.get('/services', asyncHandler(getServiceApi));
router.get('/gallery', asyncHandler(getGalleryApi));

router.post(
  '/orders',
  orderLimiter,
  [
    body('name')
      .trim()
      .isLength({ min: 2, max: 120 })
      .withMessage('Имя должно содержать от 2 до 120 символов'),
    body('phone').trim().isLength({ min: 5, max: 40 }).withMessage('Телефон обязателен'),
    body('email').optional({ checkFalsy: true }).trim().isEmail().withMessage('Некорректный email'),
    body('service').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
    body('message').optional({ checkFalsy: true }).trim().isLength({ max: 3000 }),
    body('website')
      .optional()
      .custom((value) => !value)
      .withMessage('Не удалось отправить заявку. Попробуйте позже.'),
  ],
  asyncHandler(createOrder)
);

module.exports = router;

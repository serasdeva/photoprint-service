const { validationResult } = require('express-validator');
const { Order } = require('../models');
const { sendOrderNotification } = require('../utils/mailer');
const { notifyAdminNewOrder } = require('../telegram/notifications');

async function createOrder(req, res) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }

  const { name, phone, email, service, message } = req.body;

  try {
    const order = await Order.create({
      name,
      phone,
      email,
      service,
      message,
      status: 'new',
    });

    try {
      await sendOrderNotification(order.toJSON());
    } catch (mailError) {
      console.error('Mail send failed:', mailError.message);
    }

    try {
      await notifyAdminNewOrder(order.toJSON());
    } catch (telegramError) {
      console.error('Telegram notify failed:', telegramError.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Заявка успешно отправлена.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Не удалось сохранить заявку.',
    });
  }
}

module.exports = { createOrder };

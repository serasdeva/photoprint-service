const { Setting } = require('../models');
const { getEnvAdminChatId } = require('./config');

const STATUS_LABELS = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Готова',
};

const STATUS_ICONS = {
  new: '🆕',
  in_progress: '⚙️',
  done: '✅',
};

const DEFAULT_WELCOME =
  'Здравствуйте! Это бот PhotoPrint Service. Здесь можно посмотреть услуги, цены и оставить заявку.';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function statusIcon(status) {
  return STATUS_ICONS[status] || '•';
}

function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  return `${hasPlus ? '+' : ''}${digits}`;
}

function validateName(name) {
  const value = String(name || '').trim();
  return value.length >= 2 && value.length <= 120;
}

function validatePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function formatPrice(price, unit) {
  const numeric = Number(price);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'по запросу';
  }
  const formatted = numeric.toLocaleString('ru-RU');
  return unit ? `${formatted} ₽ / ${unit}` : `${formatted} ₽`;
}

function adminOrderKeyboard(order) {
  return {
    inline_keyboard: [
      [
        { text: '⚙️ В работу', callback_data: `order:status:${order.id}:in_progress` },
        { text: '✅ Готово', callback_data: `order:status:${order.id}:done` },
      ],
      [{ text: '📋 Открыть в админке', url: `${adminPanelUrl()}/admin/orders?q=${order.id}` }],
    ],
  };
}

function getBaseUrl() {
  const base = (process.env.BASE_URL || '').replace(/\/+$/, '');
  if (base) {
    return base;
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

function adminPanelUrl() {
  return getBaseUrl();
}

function formatAdminOrder(order) {
  const lines = [
    `${statusIcon(order.status)} <b>Новая заявка #${order.id}</b>`,
    `Источник: ${order.source === 'telegram' ? 'Telegram' : 'сайт'}`,
    `<b>Имя:</b> ${escapeHtml(order.name)}`,
    `<b>Телефон:</b> ${escapeHtml(order.phone)}`,
  ];

  if (order.email) {
    lines.push(`<b>Email:</b> ${escapeHtml(order.email)}`);
  }
  if (order.service) {
    lines.push(`<b>Услуга:</b> ${escapeHtml(order.service)}`);
  }
  if (order.message) {
    lines.push(`<b>Комментарий:</b> ${escapeHtml(order.message)}`);
  }

  return lines.join('\n');
}

function formatClientOrder(order) {
  return [
    `${statusIcon(order.status)} Заявка #${order.id} — <b>${statusLabel(order.status)}</b>`,
    order.service ? `Услуга: ${escapeHtml(order.service)}` : null,
    `Создана: ${new Date(order.createdAt).toLocaleString('ru-RU')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function getTelegramSettings() {
  const rows = await Setting.findAll({
    where: { key: ['telegramAdminChatId', 'telegramNotifyOrders', 'telegramWelcome'] },
    raw: true,
  });
  const map = {};
  rows.forEach((row) => {
    map[row.key] = row.value;
  });

  return {
    adminChatId: String(map.telegramAdminChatId || getEnvAdminChatId() || '').trim(),
    notifyOrders: map.telegramNotifyOrders !== 'false',
    welcome: map.telegramWelcome || DEFAULT_WELCOME,
  };
}

async function isAdminChat(chatId) {
  if (chatId === undefined || chatId === null) {
    return false;
  }
  const { adminChatId } = await getTelegramSettings();
  return Boolean(adminChatId) && String(chatId) === adminChatId;
}

module.exports = {
  STATUS_LABELS,
  DEFAULT_WELCOME,
  escapeHtml,
  statusLabel,
  statusIcon,
  normalizePhone,
  validateName,
  validatePhone,
  formatPrice,
  formatAdminOrder,
  formatClientOrder,
  adminOrderKeyboard,
  adminPanelUrl,
  getBaseUrl,
  getTelegramSettings,
  isAdminChat,
};

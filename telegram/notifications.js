const {
  formatAdminOrder,
  formatClientOrder,
  adminOrderKeyboard,
  getTelegramSettings,
} = require('./helpers');

let botRef = null;

function setBot(bot) {
  botRef = bot;
}

function getBot() {
  return botRef;
}

async function sendMessage(chatId, text, extra = {}) {
  if (!botRef || !chatId) {
    return false;
  }

  try {
    await botRef.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra });
    return true;
  } catch (error) {
    console.error('Telegram send failed:', error.message);
    return false;
  }
}

async function notifyAdminNewOrder(order) {
  if (!botRef) {
    return { skipped: true, reason: 'bot-not-running' };
  }

  const settings = await getTelegramSettings();
  if (!settings.notifyOrders) {
    return { skipped: true, reason: 'disabled' };
  }
  if (!settings.adminChatId) {
    return { skipped: true, reason: 'no-admin-chat' };
  }

  const delivered = await sendMessage(settings.adminChatId, formatAdminOrder(order), {
    reply_markup: adminOrderKeyboard(order),
    disable_web_page_preview: true,
  });

  return { skipped: false, delivered };
}

async function notifyClientStatusChange(order) {
  if (!botRef || !order || !order.telegramChatId) {
    return { skipped: true, reason: 'no-telegram-client' };
  }

  const delivered = await sendMessage(order.telegramChatId, formatClientOrder(order));
  return { skipped: false, delivered };
}

module.exports = { setBot, getBot, sendMessage, notifyAdminNewOrder, notifyClientStatusChange };

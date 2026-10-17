const { Order, TelegramSubscriber, Setting } = require('../../models');
const { isAdminChat, statusLabel, statusIcon, escapeHtml, adminPanelUrl } = require('../helpers');
const { notifyClientStatusChange, sendMessage } = require('../notifications');
const { broadcastConfirmKeyboard, backToMenuKeyboard } = require('../keyboards');
const { invalidateSettingsCache } = require('../../controllers/homeController');

const ORDER_STATUSES = ['new', 'in_progress', 'done'];

async function guard(ctx) {
  const isAdmin = await isAdminChat(ctx.chat && ctx.chat.id);
  if (!isAdmin) {
    await ctx.reply('⛔ Команда доступна только администратору. Узнать свой chat id: /whoami');
  }
  return isAdmin;
}

async function changeOrderStatus(orderId, status) {
  if (!ORDER_STATUSES.includes(status)) {
    return null;
  }

  const order = await Order.findByPk(orderId);
  if (!order) {
    return null;
  }

  await order.update({ status });
  await notifyClientStatusChange(order.toJSON());
  return order;
}

async function sendBroadcast(text) {
  const subscribers = await TelegramSubscriber.findAll({ where: { isActive: true }, raw: true });
  let sent = 0;

  for (const subscriber of subscribers) {
    const delivered = await sendMessage(subscriber.chatId, text, {
      disable_web_page_preview: true,
    });
    if (delivered) {
      sent += 1;
    }
  }

  return { total: subscribers.length, sent };
}

async function setNotifyEnabled(enabled) {
  const value = enabled ? 'true' : 'false';
  const existing = await Setting.findOne({ where: { key: 'telegramNotifyOrders' } });
  if (existing) {
    await existing.update({ value });
  } else {
    await Setting.create({ key: 'telegramNotifyOrders', value });
  }
  invalidateSettingsCache();
  return enabled;
}

async function buildStatsText() {
  const [total, newCount, inProgress, done, subscribers] = await Promise.all([
    Order.count(),
    Order.count({ where: { status: 'new' } }),
    Order.count({ where: { status: 'in_progress' } }),
    Order.count({ where: { status: 'done' } }),
    TelegramSubscriber.count({ where: { isActive: true } }),
  ]);

  return [
    '📊 <b>Статистика</b>',
    '',
    `Всего заявок: ${total}`,
    `🆕 Новых: ${newCount}`,
    `⚙️ В работе: ${inProgress}`,
    `✅ Готово: ${done}`,
    `🔔 Подписчиков: ${subscribers}`,
  ].join('\n');
}

async function buildOrdersText() {
  const orders = await Order.findAll({ order: [['createdAt', 'DESC']], limit: 10, raw: true });
  if (!orders.length) {
    return '📋 Заявок пока нет.';
  }

  const list = orders
    .map(
      (order) =>
        `${statusIcon(order.status)} #${order.id} — ${escapeHtml(order.name)}, ${escapeHtml(order.phone)}${order.service ? ` (${escapeHtml(order.service)})` : ''}`
    )
    .join('\n');

  return `📋 <b>Последние заявки</b>\n\n${list}`;
}

function sendAdminMenu(ctx) {
  return ctx.reply(
    [
      '🛠 <b>Админ-меню</b>',
      '',
      '/orders — последние заявки',
      '/stats — статистика',
      '/broadcast Текст — рассылка подписчикам',
      '/notify on|off — уведомления о новых заявках',
      '/whoami — ваш chat id',
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: backToMenuKeyboard() }
  );
}

function statusKeyboard(orderId, currentStatus) {
  const buttons = ORDER_STATUSES.filter((status) => status !== currentStatus).map((status) => ({
    text: statusLabel(status),
    callback_data: `order:status:${orderId}:${status}`,
  }));

  const rows = buttons.length ? [buttons] : [];
  rows.push([
    { text: '📋 Открыть в админке', url: `${adminPanelUrl()}/admin/orders?q=${orderId}` },
  ]);
  return { inline_keyboard: rows };
}

function register(bot) {
  bot.command('whoami', (ctx) => ctx.reply(`Ваш chat id: ${ctx.chat.id}`));

  bot.command('admin', async (ctx) => {
    if (!(await guard(ctx))) return;
    await sendAdminMenu(ctx);
  });

  bot.action('menu:admin', async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await guard(ctx))) return;
    await sendAdminMenu(ctx);
  });

  bot.command('stats', async (ctx) => {
    if (!(await guard(ctx))) return;
    await ctx.reply(await buildStatsText(), {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
  });

  bot.command('orders', async (ctx) => {
    if (!(await guard(ctx))) return;
    await ctx.reply(await buildOrdersText(), {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
  });

  bot.command('notify', async (ctx) => {
    if (!(await guard(ctx))) return;
    const arg = (ctx.message.text.split(/\s+/)[1] || '').toLowerCase();
    if (!['on', 'off'].includes(arg)) {
      await ctx.reply('Использование: /notify on или /notify off');
      return;
    }
    const enabled = await setNotifyEnabled(arg === 'on');
    await ctx.reply(enabled ? '🔔 Уведомления включены.' : '🔕 Уведомления выключены.');
  });

  bot.command('broadcast', async (ctx) => {
    if (!(await guard(ctx))) return;
    const text = (ctx.message.text || '').replace(/^\/broadcast(@\w+)?\s*/i, '').trim();
    if (!text) {
      await ctx.reply('Использование: /broadcast Текст сообщения');
      return;
    }
    if (ctx.session) {
      ctx.session.broadcastText = text;
    }
    await ctx.reply(`Предпросмотр рассылки:\n\n${text}`, {
      reply_markup: broadcastConfirmKeyboard(),
    });
  });

  bot.action('broadcast:send', async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await guard(ctx))) return;
    const text = ctx.session && ctx.session.broadcastText;
    if (!text) {
      await ctx.reply('Нет текста рассылки. Начните с /broadcast Текст');
      return;
    }
    const result = await sendBroadcast(text);
    if (ctx.session) {
      ctx.session.broadcastText = undefined;
    }
    await ctx.editMessageText(`Рассылка завершена: отправлено ${result.sent} из ${result.total}.`);
  });

  bot.action('broadcast:cancel', async (ctx) => {
    await ctx.answerCbQuery('Отменено');
    if (ctx.session) {
      ctx.session.broadcastText = undefined;
    }
    await ctx.editMessageText('Рассылка отменена.');
  });

  bot.action(/^order:status:(\d+):(new|in_progress|done)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const orderId = Number(ctx.match[1]);
    const status = ctx.match[2];
    const updated = await changeOrderStatus(orderId, status);
    if (!updated) {
      await ctx.answerCbQuery('Заявка не найдена');
      return;
    }
    await ctx.answerCbQuery(`Статус: ${statusLabel(status)}`);
    try {
      await ctx.editMessageReplyMarkup(statusKeyboard(orderId, status));
    } catch (error) {
      console.error('Telegram keyboard update failed:', error.message);
    }
  });
}

module.exports = {
  register,
  guard,
  changeOrderStatus,
  sendBroadcast,
  setNotifyEnabled,
  buildStatsText,
  buildOrdersText,
};

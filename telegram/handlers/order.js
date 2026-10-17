const { Service, Order } = require('../../models');
const { notifyAdminNewOrder } = require('../notifications');
const { escapeHtml, validateName, validatePhone, normalizePhone } = require('../helpers');
const {
  phoneShareKeyboard,
  servicesKeyboard,
  confirmOrderKeyboard,
  skipCommentKeyboard,
  removeKeyboard,
  backToMenuKeyboard,
} = require('../keyboards');
const { CANCEL_HINT } = require('../texts');
const { sendMenu } = require('./start');

const STEP_PROMPTS = {
  name: 'Как вас зовут?',
  phone: 'Укажите телефон для связи. Можно нажать кнопку ниже.',
  comment: 'Добавьте комментарий к заказу или нажмите «Пропустить».',
};

function resetOrder(ctx) {
  if (ctx.session) {
    ctx.session.order = undefined;
  }
}

async function startOrder(ctx) {
  if (!ctx.session) {
    return;
  }
  ctx.session.order = { step: 'name', data: {} };
  await ctx.reply(STEP_PROMPTS.name, { reply_markup: removeKeyboard() });
}

async function askService(ctx) {
  const services = await Service.findAll({
    where: { isActive: true },
    order: [['order', 'ASC']],
    limit: 20,
    raw: true,
  });

  if (!services.length) {
    await ctx.reply('К сожалению, каталог услуг временно недоступен.', {
      reply_markup: backToMenuKeyboard(),
    });
    resetOrder(ctx);
    return;
  }

  await ctx.reply('Выберите услугу:', { reply_markup: servicesKeyboard(services) });
}

async function buildSummary(order) {
  let serviceTitle = order.serviceTitle || 'не выбрана';
  if (order.serviceId) {
    const service = await Service.findByPk(order.serviceId, { raw: true });
    if (service) {
      serviceTitle = service.title;
    }
  }

  return [
    '📝 <b>Проверьте заявку</b>',
    '',
    `<b>Имя:</b> ${escapeHtml(order.name)}`,
    `<b>Телефон:</b> ${escapeHtml(order.phone)}`,
    `<b>Услуга:</b> ${escapeHtml(serviceTitle)}`,
    order.message ? `<b>Комментарий:</b> ${escapeHtml(order.message)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function finalizeOrder({ chatId, userId, name, phone, serviceId, serviceTitle, message }) {
  let title = serviceTitle || '';
  if (serviceId) {
    const service = await Service.findByPk(serviceId, { raw: true });
    if (service) {
      title = service.title;
    }
  }

  const order = await Order.create({
    name,
    phone,
    email: '',
    service: title,
    message: message || '',
    status: 'new',
    source: 'telegram',
    telegramChatId: String(chatId),
    telegramUserId: userId ? String(userId) : null,
  });

  await notifyAdminNewOrder(order.toJSON());
  return order;
}

async function processTextStep(ctx) {
  const order = ctx.session && ctx.session.order;
  if (!order) {
    return false;
  }

  const text = (ctx.message && ctx.message.text) || '';

  if (order.step === 'name') {
    if (!validateName(text)) {
      await ctx.reply('Пожалуйста, укажите имя (от 2 до 120 символов).');
      return true;
    }
    order.data.name = text.trim();
    order.step = 'phone';
    await ctx.reply(STEP_PROMPTS.phone, { reply_markup: phoneShareKeyboard() });
    return true;
  }

  if (order.step === 'phone') {
    if (!validatePhone(text)) {
      await ctx.reply('Пожалуйста, укажите корректный номер телефона (не менее 10 цифр).');
      return true;
    }
    order.data.phone = normalizePhone(text);
    order.step = 'service';
    await askService(ctx);
    return true;
  }

  if (order.step === 'comment') {
    order.data.message = text.trim();
    order.step = 'confirm';
    await ctx.reply(await buildSummary(order.data), {
      parse_mode: 'HTML',
      reply_markup: confirmOrderKeyboard(),
    });
    return true;
  }

  return false;
}

async function processContact(ctx) {
  const order = ctx.session && ctx.session.order;
  if (!order || order.step !== 'phone') {
    return false;
  }

  const phone = ctx.message.contact && ctx.message.contact.phone_number;
  if (!validatePhone(phone)) {
    await ctx.reply('Не удалось прочитать номер. Введите его вручную.');
    return true;
  }

  order.data.phone = normalizePhone(phone);
  order.step = 'service';
  await ctx.reply('Спасибо!', { reply_markup: removeKeyboard() });
  await askService(ctx);
  return true;
}

function register(bot) {
  bot.use(async (ctx, next) => {
    try {
      if (!ctx.session || !ctx.session.order) {
        return next();
      }

      if (ctx.message && ctx.message.contact) {
        const handled = await processContact(ctx);
        if (handled) {
          return undefined;
        }
      }

      if (ctx.message && typeof ctx.message.text === 'string') {
        if (ctx.message.text.startsWith('/')) {
          return next();
        }
        const handled = await processTextStep(ctx);
        if (handled) {
          return undefined;
        }
      }
    } catch (error) {
      console.error('Order step failed:', error.message);
    }

    return next();
  });

  bot.command('order', (ctx) => startOrder(ctx));
  bot.action('order:new', async (ctx) => {
    await ctx.answerCbQuery();
    await startOrder(ctx);
  });

  bot.command('cancel', async (ctx) => {
    resetOrder(ctx);
    await ctx.reply('Оформление отменено.', { reply_markup: removeKeyboard() });
    await sendMenu(ctx);
  });

  bot.action('order:cancel', async (ctx) => {
    await ctx.answerCbQuery('Отменено');
    resetOrder(ctx);
    await ctx.editMessageText('Оформление отменено.');
    await sendMenu(ctx);
  });

  bot.action(/^order:service:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const order = ctx.session && ctx.session.order;
    if (!order) {
      return;
    }
    order.data.serviceId = Number(ctx.match[1]);
    order.step = 'comment';
    await ctx.reply(`Комментарий к заказу (${CANCEL_HINT})`, {
      reply_markup: skipCommentKeyboard(),
    });
  });

  bot.action('order:skip', async (ctx) => {
    await ctx.answerCbQuery();
    const order = ctx.session && ctx.session.order;
    if (!order) {
      return;
    }
    order.data.message = '';
    order.step = 'confirm';
    await ctx.reply(await buildSummary(order.data), {
      parse_mode: 'HTML',
      reply_markup: confirmOrderKeyboard(),
    });
  });

  bot.action('order:confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const order = ctx.session && ctx.session.order;
    if (!order || !order.data.name || !order.data.phone) {
      await ctx.reply('Заявка потерялась. Начните заново: /order');
      resetOrder(ctx);
      return;
    }

    try {
      const created = await finalizeOrder({
        chatId: ctx.chat.id,
        userId: ctx.from && ctx.from.id,
        name: order.data.name,
        phone: order.data.phone,
        serviceId: order.data.serviceId,
        serviceTitle: order.data.serviceTitle,
        message: order.data.message,
      });

      resetOrder(ctx);
      await ctx.reply(
        `✅ Заявка №${created.id} принята! Менеджер свяжется с вами в ближайшее время.`,
        { reply_markup: removeKeyboard() }
      );
      await sendMenu(ctx);
    } catch (error) {
      console.error('Order create failed:', error.message);
      await ctx.reply('Не удалось создать заявку. Попробуйте ещё раз или позвоните нам.');
    }
  });
}

module.exports = {
  register,
  startOrder,
  finalizeOrder,
  buildSummary,
  processTextStep,
  processContact,
  askService,
  resetOrder,
};

const { TelegramSubscriber } = require('../../models');
const { escapeHtml } = require('../helpers');
const { backToMenuKeyboard } = require('../keyboards');

async function toggleSubscription(ctx) {
  const chatId = String(ctx.chat.id);
  const profile = {
    username: (ctx.from && ctx.from.username) || '',
    firstName: (ctx.from && ctx.from.first_name) || '',
  };

  const existing = await TelegramSubscriber.findOne({ where: { chatId } });

  if (!existing) {
    await TelegramSubscriber.create({ chatId, ...profile, isActive: true });
    return true;
  }

  await existing.update({ ...profile, isActive: !existing.isActive });
  return existing.isActive;
}

function register(bot) {
  bot.command('subscribe', async (ctx) => {
    const active = await toggleSubscription(ctx);
    await ctx.reply(
      active
        ? '🔔 Вы подписались на новости и акции. Отписаться можно командой /unsubscribe'
        : '🔕 Подписка отключена. Включить снова — /subscribe',
      { reply_markup: backToMenuKeyboard() }
    );
  });

  bot.command('unsubscribe', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const existing = await TelegramSubscriber.findOne({ where: { chatId } });
    if (existing) {
      await existing.update({ isActive: false });
    }
    await ctx.reply('🔕 Подписка отключена.', { reply_markup: backToMenuKeyboard() });
  });

  bot.action('menu:subscribe', async (ctx) => {
    await ctx.answerCbQuery();
    const active = await toggleSubscription(ctx);
    await ctx.reply(
      active
        ? `🔔 Подписка включена, ${escapeHtml((ctx.from && ctx.from.first_name) || 'спасибо')}!`
        : '🔕 Подписка отключена.',
      { reply_markup: backToMenuKeyboard() }
    );
  });
}

module.exports = { register, toggleSubscription };

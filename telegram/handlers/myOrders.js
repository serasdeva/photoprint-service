const { Order } = require('../../models');
const { formatClientOrder } = require('../helpers');
const { backToMenuKeyboard } = require('../keyboards');

async function buildMyOrdersText(chatId) {
  const orders = await Order.findAll({
    where: { telegramChatId: String(chatId) },
    order: [['createdAt', 'DESC']],
    limit: 10,
    raw: true,
  });

  if (!orders.length) {
    return '📦 <b>Мои заявки</b>\n\nУ вас пока нет заявок. Оформить можно командой /order.';
  }

  return `📦 <b>Мои заявки</b>\n\n${orders.map(formatClientOrder).join('\n\n')}`;
}

function register(bot) {
  bot.command('myorders', async (ctx) => {
    await ctx.reply(await buildMyOrdersText(ctx.chat.id), {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
  });

  bot.action('menu:myorders', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(await buildMyOrdersText(ctx.chat.id), {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
  });
}

module.exports = { register, buildMyOrdersText };

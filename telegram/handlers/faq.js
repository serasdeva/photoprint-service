const { FAQ } = require('../texts');
const { faqKeyboard, backToMenuKeyboard } = require('../keyboards');

const FAQ_BY_KEY = FAQ.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

async function sendFaq(ctx) {
  await ctx.reply('❓ <b>Частые вопросы</b>\n\nВыберите вопрос:', {
    parse_mode: 'HTML',
    reply_markup: faqKeyboard(),
  });
}

function register(bot) {
  bot.command('faq', sendFaq);
  bot.action('menu:faq', async (ctx) => {
    await ctx.answerCbQuery();
    await sendFaq(ctx);
  });

  bot.action(/^faq:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const item = FAQ_BY_KEY[key];
    if (!item) {
      await ctx.answerCbQuery('Вопрос не найден');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.reply(`<b>${item.title}</b>\n\n${item.answer}`, {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
  });
}

module.exports = { register, sendFaq };

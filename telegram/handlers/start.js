const { MENU } = require('../texts');
const { mainMenuKeyboard } = require('../keyboards');
const { getTelegramSettings, isAdminChat } = require('../helpers');
const { getDeepLink } = require('../config');

async function sendMenu(ctx) {
  const isAdmin = await isAdminChat(ctx.chat && ctx.chat.id);
  const markup = mainMenuKeyboard({ isAdmin, deepLink: getDeepLink() });
  await ctx.reply(MENU, { parse_mode: 'HTML', reply_markup: markup });
}

function register(bot) {
  bot.start(async (ctx) => {
    const { welcome } = await getTelegramSettings();
    await ctx.reply(welcome, { parse_mode: 'HTML' });
    await sendMenu(ctx);
  });

  bot.command('menu', sendMenu);
  bot.command('help', sendMenu);

  bot.action('menu:main', async (ctx) => {
    await ctx.answerCbQuery();
    if (ctx.session) {
      ctx.session.order = undefined;
      ctx.session.broadcastText = undefined;
    }
    await sendMenu(ctx);
  });
}

module.exports = { register, sendMenu };

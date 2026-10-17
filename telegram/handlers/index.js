const { mainMenuKeyboard } = require('../keyboards');
const { getDeepLink } = require('../config');

const HANDLERS = [
  require('./start'),
  require('./order'),
  require('./catalog'),
  require('./gallery'),
  require('./contacts'),
  require('./myOrders'),
  require('./faq'),
  require('./subscribe'),
  require('./admin'),
];

function registerHandlers(bot) {
  HANDLERS.forEach((handler) => {
    if (typeof handler.register === 'function') {
      handler.register(bot);
    }
  });

  bot.on('text', async (ctx) => {
    await ctx.reply('Не понял команду. Воспользуйтесь меню ниже или командой /menu.', {
      reply_markup: mainMenuKeyboard({ deepLink: getDeepLink() }),
    });
  });
}

module.exports = { registerHandlers, HANDLERS };

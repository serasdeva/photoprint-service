const { Telegraf, session } = require('telegraf');
const { isBotEnabled, getToken, getSessionsDir } = require('./config');
const { setBot } = require('./notifications');
const FileSessionStore = require('./sessionStore');
const { registerHandlers } = require('./handlers');

let bot = null;

function initBot() {
  if (!isBotEnabled()) {
    console.log('[telegram] Bot is disabled (set BOT_TOKEN and BOT_ENABLED=true to enable).');
    return null;
  }

  if (bot) {
    return bot;
  }

  const sessionStore = new FileSessionStore({ path: getSessionsDir() });
  sessionStore.prune();
  setInterval(() => sessionStore.prune(), 24 * 60 * 60 * 1000).unref();

  bot = new Telegraf(getToken());
  bot.use(session({ store: sessionStore }));
  registerHandlers(bot);
  setBot(bot);

  bot.catch((error, ctx) => {
    console.error(`[telegram] Error while handling ${ctx.updateType}:`, error.message);
  });

  bot
    .launch()
    .catch((error) => {
      console.error('[telegram] Failed to launch bot:', error.message);
    })
    .finally(() => {
      console.log('[telegram] Bot stopped.');
    });

  console.log('[telegram] Bot started (long polling).');
  return bot;
}

async function stopBot() {
  if (!bot) {
    return;
  }
  try {
    await bot.stop('stop');
  } catch (error) {
    console.error('[telegram] Failed to stop bot:', error.message);
  }
  bot = null;
  setBot(null);
}

module.exports = { initBot, stopBot };

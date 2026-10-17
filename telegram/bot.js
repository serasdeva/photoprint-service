const { Telegraf, session } = require('telegraf');
const { isBotEnabled, getToken, getSessionsDir } = require('./config');
const { setBot } = require('./notifications');
const FileSessionStore = require('./sessionStore');
const { registerHandlers } = require('./handlers');

let bot = null;
let stopping = false;

function stoppedUpdates() {
  if (stopping) {
    return;
  }
  stopping = true;
  if (bot) {
    bot.stop('shutdown');
  }
}

function initBot() {
  if (!isBotEnabled()) {
    console.log('[telegram] Bot is disabled (set BOT_TOKEN and BOT_ENABLED=true to enable).');
    return null;
  }

  if (bot) {
    return bot;
  }

  bot = new Telegraf(getToken());
  bot.use(session({ store: new FileSessionStore({ path: getSessionsDir() }) }));
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

  process.once('SIGINT', stoppedUpdates);
  process.once('SIGTERM', stoppedUpdates);

  console.log('[telegram] Bot started (long polling).');
  return bot;
}

async function stopBot() {
  if (!bot) {
    return;
  }
  stopping = true;
  try {
    await bot.stop('stop');
  } catch (error) {
    console.error('[telegram] Failed to stop bot:', error.message);
  }
  bot = null;
  setBot(null);
}

module.exports = { initBot, stopBot };

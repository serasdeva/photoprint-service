const path = require('path');

function getToken() {
  return String(process.env.BOT_TOKEN || '').trim();
}

function isBotEnabled() {
  return Boolean(getToken()) && process.env.BOT_ENABLED !== 'false';
}

function getBotUsername() {
  return String(process.env.BOT_USERNAME || '')
    .replace(/^@/, '')
    .trim();
}

function getEnvAdminChatId() {
  return String(process.env.BOT_ADMIN_CHAT_ID || '').trim();
}

function getSessionsDir() {
  return path.join(__dirname, '..', 'data', 'telegram-sessions');
}

function getDeepLink() {
  const username = getBotUsername();
  return username ? `https://t.me/${username}` : '';
}

module.exports = {
  getToken,
  isBotEnabled,
  getBotUsername,
  getEnvAdminChatId,
  getSessionsDir,
  getDeepLink,
};

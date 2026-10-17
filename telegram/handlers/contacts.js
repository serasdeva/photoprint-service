const { escapeHtml, getBaseUrl } = require('../helpers');

async function sendContacts(ctx) {
  const { getSettingsMap } = require('../../controllers/homeController');
  const settings = await getSettingsMap();

  const lines = [
    '☎️ <b>Контакты</b>',
    '',
    settings.address ? `📍 ${escapeHtml(settings.address)}` : null,
    settings.phone ? `📞 ${escapeHtml(settings.phone)}` : null,
    settings.email ? `✉️ ${escapeHtml(settings.email)}` : null,
    settings.workHours ? `🕘 ${escapeHtml(settings.workHours)}` : null,
  ].filter(Boolean);

  const markup = {
    inline_keyboard: [
      [
        { text: '🌐 Открыть сайт', url: getBaseUrl() },
        { text: '📍 Карта', url: `${getBaseUrl()}/contacts` },
      ],
      [{ text: '⬅️ В меню', callback_data: 'menu:main' }],
    ],
  };

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: markup });
}

function register(bot) {
  bot.command('contacts', (ctx) => sendContacts(ctx));
  bot.action('menu:contacts', async (ctx) => {
    await ctx.answerCbQuery();
    await sendContacts(ctx);
  });
}

module.exports = { register, sendContacts };

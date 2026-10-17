const { GalleryItem } = require('../../models');
const { escapeHtml, getBaseUrl } = require('../helpers');

async function buildGalleryText() {
  const items = await GalleryItem.findAll({
    order: [['order', 'ASC']],
    limit: 10,
    raw: true,
  });

  if (!items.length) {
    return '🖼 <b>Галерея работ</b>\n\nПока нет примеров. Загляните позже.';
  }

  const list = items
    .map((item) => {
      const lines = [
        `• <b>${escapeHtml(item.title)}</b>${item.category ? ` (${escapeHtml(item.category)})` : ''}`,
      ];
      if (item.description) {
        lines.push(`  ${escapeHtml(item.description)}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return `🖼 <b>Галерея работ</b>\n\n${list}`;
}

function galleryKeyboard() {
  const url = `${getBaseUrl()}/gallery`;
  return {
    inline_keyboard: [
      [{ text: '🌐 Смотреть на сайте', url }],
      [{ text: '⬅️ В меню', callback_data: 'menu:main' }],
    ],
  };
}

function register(bot) {
  bot.command('gallery', async (ctx) => {
    await ctx.reply(await buildGalleryText(), {
      parse_mode: 'HTML',
      reply_markup: galleryKeyboard(),
    });
  });

  bot.action('menu:gallery', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(await buildGalleryText(), {
      parse_mode: 'HTML',
      reply_markup: galleryKeyboard(),
    });
  });
}

module.exports = { register, buildGalleryText };

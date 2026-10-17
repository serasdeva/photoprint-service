const { Service } = require('../../models');
const { formatPrice, escapeHtml } = require('../helpers');
const { backToMenuKeyboard } = require('../keyboards');

async function buildCatalogText() {
  const services = await Service.findAll({
    where: { isActive: true },
    order: [['order', 'ASC']],
    raw: true,
  });

  if (!services.length) {
    return '🖨 <b>Услуги и цены</b>\n\nКаталог пока пуст. Загляните позже.';
  }

  const items = services
    .map((service) => {
      const lines = [
        `• <b>${escapeHtml(service.title)}</b> — ${formatPrice(service.price, service.priceUnit)}`,
      ];
      if (service.description) {
        lines.push(`  ${escapeHtml(service.description)}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return `🖨 <b>Услуги и цены</b>\n\n${items}`;
}

function register(bot) {
  bot.command('services', async (ctx) => {
    await ctx.reply(await buildCatalogText(), {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
  });

  bot.action('menu:services', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(await buildCatalogText(), {
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
  });
}

module.exports = { register, buildCatalogText };

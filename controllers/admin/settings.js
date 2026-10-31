const { Setting } = require('../../models');
const { getSettingsMap, invalidateSettingsCache } = require('../homeController');
const { saveAdminFormDraft, consumeAdminFormDraft } = require('../../utils/adminFormDraft');
const { getDeepLink } = require('../../telegram/config');

const ALLOWED_SETTING_KEYS = [
  'siteName',
  'phone',
  'email',
  'address',
  'workHours',
  'heroTitle',
  'heroSubtitle',
  'mapEmbed',
];

async function upsertSetting(key, value) {
  const existing = await Setting.findOne({ where: { key } });
  if (existing) {
    await existing.update({ value });
  } else {
    await Setting.create({ key, value });
  }
}

async function renderSettingsPage(req, res) {
  const settings = await getSettingsMap();
  const settingsDraft = consumeAdminFormDraft(req, 'settings');
  res.render('admin/settings', {
    title: 'Настройки сайта',
    settings: { ...settings, ...settingsDraft },
    activePage: 'settings',
  });
}

async function saveSettings(req, res) {
  try {
    for (const key of ALLOWED_SETTING_KEYS) {
      if (!(key in req.body)) continue;

      let value = String(req.body[key] ?? '');

      if (key === 'mapEmbed') {
        const allowedPattern = /<iframe\s+[^>]*src=["'][^"']+["'][^>]*>\s*<\/iframe>/i;
        if (!allowedPattern.test(value)) {
          throw new Error('Недопустимый HTML-код карты');
        }
      }

      await upsertSetting(key, value);
    }

    invalidateSettingsCache();
    req.flash('success', 'Настройки сохранены');
  } catch (error) {
    console.error('Admin settings save failed:', error);
    saveAdminFormDraft(req, 'settings');
    req.flash('error', 'Не удалось сохранить настройки. Проверьте данные и попробуйте снова.');
  }

  return res.redirect('/admin/settings');
}

async function renderTelegramPage(req, res) {
  const { getTelegramSettings } = require('../../telegram/helpers');
  const { getBotUsername } = require('../../telegram/config');
  const [settings, telegram] = await Promise.all([getSettingsMap(), getTelegramSettings()]);

  res.render('admin/telegram', {
    title: 'Telegram-бот',
    settings,
    telegram,
    botUsername: getBotUsername(),
    deepLink: getDeepLink(),
    botConfigured: Boolean(process.env.BOT_TOKEN),
    activePage: 'telegram',
  });
}

async function saveTelegramSettings(req, res) {
  try {
    const adminChatId = String(req.body.telegramAdminChatId || '').trim();
    const welcome = String(req.body.telegramWelcome || '')
      .trim()
      .slice(0, 4000);
    const notifyOrders = req.body.telegramNotifyOrders ? 'true' : 'false';

    await upsertSetting('telegramAdminChatId', adminChatId);
    await upsertSetting('telegramWelcome', welcome);
    await upsertSetting('telegramNotifyOrders', notifyOrders);

    invalidateSettingsCache();
    req.flash('success', 'Настройки Telegram сохранены');
  } catch (error) {
    console.error('Telegram settings save failed:', error);
    req.flash('error', 'Не удалось сохранить настройки Telegram');
  }

  return res.redirect('/admin/settings/telegram');
}

async function sendTelegramTest(req, res) {
  const { getTelegramSettings } = require('../../telegram/helpers');
  const { sendMessage, getBot } = require('../../telegram/notifications');

  try {
    if (!getBot()) {
      req.flash(
        'error',
        'Бот не запущен. Укажите BOT_TOKEN и BOT_ENABLED=true, затем перезапустите сервер.'
      );
      return res.redirect('/admin/settings/telegram');
    }

    const { adminChatId } = await getTelegramSettings();
    if (!adminChatId) {
      req.flash('error', 'Сначала укажите chat id администратора.');
      return res.redirect('/admin/settings/telegram');
    }

    const delivered = await sendMessage(
      adminChatId,
      '✅ Тестовое сообщение от PhotoPrint Service. Уведомления настроены.'
    );
    req.flash(
      delivered ? 'success' : 'error',
      delivered ? 'Тестовое сообщение отправлено' : 'Не удалось отправить сообщение'
    );
  } catch (error) {
    console.error('Telegram test failed:', error);
    req.flash('error', 'Не удалось отправить тестовое сообщение');
  }

  return res.redirect('/admin/settings/telegram');
}

module.exports = {
  renderSettingsPage,
  saveSettings,
  renderTelegramPage,
  saveTelegramSettings,
  sendTelegramTest,
};

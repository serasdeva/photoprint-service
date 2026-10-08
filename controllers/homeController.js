const { Service, GalleryItem, Setting } = require('../models');

const defaultSettings = {
  siteName: 'PhotoPrint Service',
  phone: '+7 (495) 123-45-67',
  email: 'hello@photoprint.local',
  address: 'пгт. Яшкино, Суворово 8а',
  workHours: 'Пн–Сб: 09:00–20:00',
  heroTitle: 'Печать, копирование и оформление документов',
  heroSubtitle: 'Быстро, качественно и по доступной цене для дома, офиса и бизнеса.',
  mapEmbed:
    '<iframe src="https://www.google.com/maps?q=%D0%BF%D0%B3%D1%82.%20%D0%8F%D1%88%D0%BA%D0%B8%D0%BD%D0%BE%2C%20%D0%A1%D1%83%D0%B2%D0%BE%D1%80%D0%BE%D0%B2%D0%BE%208%D0%B0&z=15&output=embed" width="100%" height="100%" frameborder="0" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>',
};

const SETTINGS_CACHE_TTL = 60 * 1000;
let settingsCache = null;
let settingsCacheAt = 0;

async function getSettingsMap() {
  if (settingsCache && Date.now() - settingsCacheAt < SETTINGS_CACHE_TTL) {
    return settingsCache;
  }

  const rows = await Setting.findAll({ raw: true });
  const map = {};

  rows.forEach((row) => {
    map[row.key] = row.value;
  });

  settingsCache = { ...defaultSettings, ...map };
  settingsCacheAt = Date.now();
  return settingsCache;
}

function invalidateSettingsCache() {
  settingsCache = null;
  settingsCacheAt = 0;
}

async function renderHome(req, res) {
  const [services, gallery, settings] = await Promise.all([
    Service.findAll({ where: { isActive: true }, order: [['order', 'ASC']], limit: 3, raw: true }),
    GalleryItem.findAll({ order: [['order', 'ASC']], limit: 6, raw: true }),
    getSettingsMap(),
  ]);

  res.render('index', {
    title: settings.siteName,
    services,
    gallery,
    settings,
    activePage: 'home',
  });
}

async function renderContacts(req, res) {
  const settings = await getSettingsMap();
  res.render('contacts', {
    title: 'Контакты',
    settings,
    activePage: 'contacts',
  });
}

async function renderPrivacy(req, res) {
  res.render('privacy', {
    title: 'Политика конфиденциальности',
    activePage: 'privacy',
  });
}

module.exports = {
  renderHome,
  renderContacts,
  renderPrivacy,
  getSettingsMap,
  invalidateSettingsCache,
};

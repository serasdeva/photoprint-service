const { Service, GalleryItem, Order, Setting } = require('../models');
const { filterByTerm, paginate } = require('../utils/search');
const { createService, updateService } = require('./serviceController');
const { createGalleryItem, pickUpload } = require('./galleryController');
const { getSettingsMap, invalidateSettingsCache } = require('./homeController');
const { safeDeleteUpload } = require('../utils/uploads');
const { toCsv, formatDateTime, formatFileDate } = require('../utils/csv');
const { saveAdminFormDraft, consumeAdminFormDraft } = require('../utils/adminFormDraft');
const { notifyClientStatusChange } = require('../telegram/notifications');
const { getDeepLink } = require('../telegram/config');

const ORDER_STATUSES = ['new', 'in_progress', 'done'];
const ORDER_EXPORT_COLUMNS = [
  'id',
  'createdAt',
  'name',
  'phone',
  'email',
  'service',
  'message',
  'status',
  'source',
];

async function renderDashboard(req, res) {
  const [services, galleryItems, totalOrders, newOrdersCount, newOrders, orders] =
    await Promise.all([
      Service.count(),
      GalleryItem.count(),
      Order.count(),
      Order.count({ where: { status: 'new' } }),
      Order.findAll({
        where: { status: 'new' },
        order: [['createdAt', 'DESC']],
        limit: 5,
        raw: true,
      }),
      Order.findAll({ order: [['createdAt', 'DESC']], limit: 8, raw: true }),
    ]);

  res.render('admin/dashboard', {
    title: 'Панель управления',
    stats: {
      services,
      galleryItems,
      orders: totalOrders,
      newOrders: newOrdersCount,
    },
    newOrders,
    recentOrders: orders,
    activePage: 'dashboard',
  });
}

async function renderServicesPage(req, res) {
  const term = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  // Каталог небольшой, поэтому фильтруем в JS: SQLite LIKE не учитывает регистр кириллицы.
  const rows = await Service.findAll({ order: [['order', 'ASC']], raw: true });
  const matched = filterByTerm(rows, term, ['title', 'slug', 'description']);
  const { items, pagination } = paginate(matched, req.query.page, 20);

  res.render('admin/services', {
    title: 'Услуги',
    services: items,
    filters: { q: term },
    pagination,
    activePage: 'services',
  });
}

async function renderServiceForm(req, res) {
  const { id } = req.params;
  let service = null;

  if (id) {
    service = await Service.findByPk(id);
    if (!service) {
      req.flash('error', 'Услуга не найдена');
      return res.redirect('/admin/services');
    }
  }

  const formDraft = consumeAdminFormDraft(req, 'services', id);
  const formValues = {
    title: '',
    slug: '',
    description: '',
    price: 0,
    priceUnit: 'шт',
    icon: 'fa-print',
    order: 0,
    isActive: false,
    ...(service ? service.get({ plain: true }) : {}),
    ...formDraft,
  };

  res.render('admin/service-form', {
    title: service ? 'Редактировать услугу' : 'Новая услуга',
    service,
    formValues,
    activePage: 'services',
  });
}

async function saveService(req, res) {
  const { id } = req.params;

  try {
    if (id) {
      const service = await Service.findByPk(id);
      if (!service) {
        req.flash('error', 'Услуга не найдена');
        return res.redirect('/admin/services');
      }
      await updateService(req, res, service);
      req.flash('success', 'Услуга обновлена');
      return res.redirect('/admin/services');
    }

    await createService(req, res);
    req.flash('success', 'Услуга добавлена');
    return res.redirect('/admin/services');
  } catch (error) {
    console.error('Admin service save failed:', error);
    saveAdminFormDraft(req, 'services', id);
    req.flash('error', 'Не удалось сохранить услугу. Проверьте данные и попробуйте снова.');
    return res.redirect(id ? `/admin/services/${id}/edit` : '/admin/services/new');
  }
}

async function deleteService(req, res) {
  const { id } = req.params;
  const service = await Service.findByPk(id);

  if (!service) {
    req.flash('error', 'Услуга не найдена');
    return res.redirect('/admin/services');
  }

  if (service.image) {
    safeDeleteUpload(service.image);
  }

  await service.destroy();
  req.flash('success', 'Услуга удалена');
  return res.redirect('/admin/services');
}

async function renderGalleryPage(req, res) {
  const term = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  // См. комментарий в renderServicesPage: поиск по кириллице выполняется в JS.
  const rows = await GalleryItem.findAll({ order: [['order', 'ASC']], raw: true });
  const matched = filterByTerm(rows, term, ['title', 'category', 'description']);
  const { items, pagination } = paginate(matched, req.query.page, 20);

  res.render('admin/gallery', {
    title: 'Галерея',
    items,
    filters: { q: term },
    pagination,
    activePage: 'gallery',
  });
}

async function renderGalleryForm(req, res) {
  const { id } = req.params;
  let item = null;

  if (id) {
    item = await GalleryItem.findByPk(id);
    if (!item) {
      req.flash('error', 'Элемент галереи не найден');
      return res.redirect('/admin/gallery');
    }
  }

  const rows = await GalleryItem.findAll({ attributes: ['category'], raw: true });
  const categories = [...new Set(rows.map((row) => row.category).filter(Boolean))].sort();

  const formDraft = consumeAdminFormDraft(req, 'gallery', id);
  const formValues = {
    title: '',
    description: '',
    type: 'image',
    category: 'general',
    order: 0,
    ...(item ? item.get({ plain: true }) : {}),
    ...formDraft,
  };

  res.render('admin/gallery-form', {
    title: item ? 'Редактировать элемент' : 'Новый элемент галереи',
    item,
    categories,
    formValues,
    activePage: 'gallery',
  });
}

async function saveGallery(req, res) {
  const { id } = req.params;

  try {
    if (id) {
      const item = await GalleryItem.findByPk(id);
      if (!item) {
        req.flash('error', 'Элемент галереи не найден');
        return res.redirect('/admin/gallery');
      }

      const { title, category, description, order, type, removeFile, removePoster } = req.body;
      const mediaFile = pickUpload(req, 'media');
      const posterFile = pickUpload(req, 'poster');
      const wantsRemoveFile = removeFile === '1' || removeFile === 'on';
      const wantsRemovePoster = removePoster === '1' || removePoster === 'on';

      // Нельзя оставить запись галереи без файла: url обязателен (notEmpty).
      if (wantsRemoveFile && !mediaFile) {
        const error = new Error('Нельзя удалить файл без загрузки нового');
        error.status = 400;
        throw error;
      }

      const updateData = {
        title,
        category: category || 'general',
        description: description || '',
        order: Number(order || 0),
        type: mediaFile
          ? mediaFile.mimetype === 'video/mp4'
            ? 'video'
            : 'image'
          : type || item.type,
      };
      let mediaCleared = false;

      if (mediaFile) {
        if (item.url) safeDeleteUpload(item.url);
        updateData.url = `/uploads/gallery/${mediaFile.filename}`;
        updateData.thumbnail = null;
        mediaCleared = true;
      }

      if (posterFile) {
        const posterUrl = `/uploads/gallery/${posterFile.filename}`;
        if (item.thumbnail && item.thumbnail !== posterUrl) {
          safeDeleteUpload(item.thumbnail);
        }
        updateData.thumbnail = posterUrl;
      } else if (wantsRemovePoster) {
        if (item.thumbnail) safeDeleteUpload(item.thumbnail);
        updateData.thumbnail = null;
      } else if (mediaCleared && item.thumbnail) {
        safeDeleteUpload(item.thumbnail);
      }

      await item.update(updateData);
      req.flash('success', 'Элемент галереи обновлён');
      return res.redirect('/admin/gallery');
    }

    await createGalleryItem(req, res);
    req.flash('success', 'Элемент галереи добавлен');
    return res.redirect('/admin/gallery');
  } catch (error) {
    console.error('Admin gallery save failed:', error);
    saveAdminFormDraft(req, 'gallery', id);
    const message =
      error.status === 400 && error.message
        ? error.message
        : 'Не удалось сохранить элемент галереи. Проверьте данные и попробуйте снова.';
    req.flash('error', message);
    return res.redirect(id ? `/admin/gallery/${id}/edit` : '/admin/gallery/new');
  }
}

async function deleteGallery(req, res) {
  const { id } = req.params;
  const item = await GalleryItem.findByPk(id);

  if (!item) {
    req.flash('error', 'Элемент галереи не найден');
    return res.redirect('/admin/gallery');
  }

  if (item.url) {
    safeDeleteUpload(item.url);
  }
  if (item.thumbnail) {
    safeDeleteUpload(item.thumbnail);
  }

  await item.destroy();
  req.flash('success', 'Элемент удалён');
  return res.redirect('/admin/gallery');
}

// Список и экспорт обязаны фильтровать одинаково, иначе «Скачать CSV» выдаст не то, что видит админ.
async function findFilteredOrders(query) {
  const where = {};
  const status = typeof query.status === 'string' ? query.status : '';

  if (status && ORDER_STATUSES.includes(status)) {
    where.status = status;
  }

  const term = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
  const rows = await Order.findAll({ where, order: [['createdAt', 'DESC']], raw: true });
  // SQLite LIKE не учитывает регистр кириллицы, поэтому поиск остаётся на стороне JS.
  return { rows: filterByTerm(rows, term, ['name', 'phone', 'email', 'service']), term, status };
}

async function renderOrdersPage(req, res) {
  const { rows, term, status } = await findFilteredOrders(req.query);
  const { items, pagination } = paginate(rows, req.query.page, 20);

  res.render('admin/orders', {
    title: 'Заявки',
    orders: items,
    filters: { status: status || '', q: term },
    pagination,
    activePage: 'orders',
  });
}

async function exportOrdersCsv(req, res) {
  const { rows } = await findFilteredOrders(req.query);

  const dataRows = rows.map((order) =>
    ORDER_EXPORT_COLUMNS.map((column) =>
      column === 'createdAt' ? formatDateTime(order.createdAt) : order[column]
    )
  );

  // Имя файла только ASCII: кириллица в Content-Disposition требует filename*=UTF-8''...
  const filename = `orders-${formatFileDate(new Date())}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(ORDER_EXPORT_COLUMNS, dataRows));
}

async function updateOrderStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const wantsJson = req.method === 'PATCH';

  try {
    if (!ORDER_STATUSES.includes(status)) {
      throw new Error('Недопустимый статус');
    }

    const order = await Order.findByPk(id);
    if (!order) {
      if (wantsJson) {
        return res.status(404).json({ success: false, message: 'Заявка не найдена' });
      }
      req.flash('error', 'Заявка не найдена');
      return res.redirect('/admin/orders');
    }

    await order.update({ status });

    try {
      await notifyClientStatusChange(order.toJSON());
    } catch (telegramError) {
      console.error('Telegram client notify failed:', telegramError.message);
    }

    if (wantsJson) {
      return res.json({ success: true, order });
    }

    req.flash('success', 'Статус заявки обновлён');
    return res.redirect('/admin/orders');
  } catch (error) {
    if (wantsJson) {
      return res.status(400).json({ success: false, message: error.message });
    }
    req.flash('error', 'Не удалось обновить статус заявки');
    return res.redirect('/admin/orders');
  }
}

async function deleteOrder(req, res) {
  const { id } = req.params;
  const order = await Order.findByPk(id);

  if (!order) {
    req.flash('error', 'Заявка не найдена');
    return res.redirect('/admin/orders');
  }

  await order.destroy();
  req.flash('success', 'Заявка удалена');
  return res.redirect('/admin/orders');
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

async function renderTelegramPage(req, res) {
  const { getTelegramSettings } = require('../telegram/helpers');
  const { getBotUsername } = require('../telegram/config');
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
  const { getTelegramSettings } = require('../telegram/helpers');
  const { sendMessage, getBot } = require('../telegram/notifications');

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

      const existing = await Setting.findOne({ where: { key } });
      if (existing) {
        await existing.update({ value });
      } else {
        await Setting.create({ key, value });
      }
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

module.exports = {
  renderDashboard,
  renderServicesPage,
  renderServiceForm,
  saveService,
  deleteService,
  renderGalleryPage,
  renderGalleryForm,
  saveGallery,
  deleteGallery,
  renderOrdersPage,
  exportOrdersCsv,
  updateOrderStatus,
  deleteOrder,
  renderSettingsPage,
  saveSettings,
  renderTelegramPage,
  saveTelegramSettings,
  sendTelegramTest,
};

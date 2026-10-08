const { Op } = require('sequelize');
const { Service, GalleryItem, Order, Setting } = require('../models');
const { createService, updateService } = require('./serviceController');
const { createGalleryItem, pickUpload } = require('./galleryController');
const { getSettingsMap, invalidateSettingsCache } = require('./homeController');
const { safeDeleteUpload } = require('../utils/uploads');

const ORDER_STATUSES = ['new', 'in_progress', 'done'];

async function renderDashboard(req, res) {
  const [services, galleryItems, totalOrders, orders] = await Promise.all([
    Service.count(),
    GalleryItem.count(),
    Order.count(),
    Order.findAll({ order: [['createdAt', 'DESC']], limit: 8, raw: true }),
  ]);

  res.render('admin/dashboard', {
    title: 'Панель управления',
    stats: {
      services,
      galleryItems,
      orders: totalOrders,
    },
    recentOrders: orders,
    activePage: 'dashboard',
  });
}

async function renderServicesPage(req, res) {
  const services = await Service.findAll({ order: [['order', 'ASC']], raw: true });
  res.render('admin/services', {
    title: 'Услуги',
    services,
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

  res.render('admin/service-form', {
    title: service ? 'Редактировать услугу' : 'Новая услуга',
    service,
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
    req.flash('error', 'Ошибка при сохранении услуги');
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
  const items = await GalleryItem.findAll({ order: [['order', 'ASC']], raw: true });
  res.render('admin/gallery', {
    title: 'Галерея',
    items,
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

  res.render('admin/gallery-form', {
    title: item ? 'Редактировать элемент' : 'Новый элемент галереи',
    item,
    categories,
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
      const updateData = {
        title,
        category: category || 'general',
        description: description || '',
        order: Number(order || 0),
        type: type || item.type,
      };
      let mediaCleared = false;

      if (mediaFile) {
        if (item.url) safeDeleteUpload(item.url);
        updateData.url = `/uploads/gallery/${mediaFile.filename}`;
        updateData.thumbnail = null;
        mediaCleared = true;
      } else if (removeFile === '1' || removeFile === 'on') {
        if (item.url) safeDeleteUpload(item.url);
        updateData.url = '';
        updateData.thumbnail = null;
        mediaCleared = true;
      }

      if (posterFile) {
        const posterUrl = `/uploads/gallery/${posterFile.filename}`;
        if (item.thumbnail && item.thumbnail !== posterUrl) {
          safeDeleteUpload(item.thumbnail);
        }
        updateData.thumbnail = posterUrl;
      } else if (removePoster === '1' || removePoster === 'on') {
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
    req.flash('error', 'Ошибка при сохранении файла галереи');
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

async function renderOrdersPage(req, res) {
  const { status, q } = req.query;
  const where = {};

  if (status && ORDER_STATUSES.includes(status)) {
    where.status = status;
  }

  const term = (q || '').trim();
  if (term) {
    const like = `%${term}%`;
    where[Op.or] = [
      { name: { [Op.like]: like } },
      { phone: { [Op.like]: like } },
      { email: { [Op.like]: like } },
      { service: { [Op.like]: like } },
    ];
  }

  const limit = 20;
  const total = await Order.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const requestedPage = Number.parseInt(req.query.page, 10) || 1;
  const page = Math.min(Math.max(1, requestedPage), totalPages);

  const orders = await Order.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    raw: true,
  });

  res.render('admin/orders', {
    title: 'Заявки',
    orders,
    filters: { status: status || '', q: term },
    pagination: { page, totalPages, total },
    activePage: 'orders',
  });
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
  res.render('admin/settings', {
    title: 'Настройки сайта',
    settings,
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
    req.flash('error', 'Не удалось сохранить настройки');
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
  updateOrderStatus,
  deleteOrder,
  renderSettingsPage,
  saveSettings,
};

const { Service, GalleryItem } = require('../../models');
const { filterByTerm, paginate } = require('../../utils/search');
const { createService, updateService } = require('../serviceController');
const { createGalleryItem, pickUpload } = require('../galleryController');
const { safeDeleteUpload } = require('../../utils/uploads');
const { saveAdminFormDraft, consumeAdminFormDraft } = require('../../utils/adminFormDraft');
const { getSolidIcons } = require('../../utils/fontAwesomeIcons');

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
    iconOptions: getSolidIcons(),
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

module.exports = {
  renderServicesPage,
  renderServiceForm,
  saveService,
  deleteService,
  renderGalleryPage,
  renderGalleryForm,
  saveGallery,
  deleteGallery,
};

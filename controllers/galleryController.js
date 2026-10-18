const { GalleryItem } = require('../models');

const CATEGORY_LABELS = {
  general: 'Общее',
  photo: 'Фото',
  print: 'Печать',
  docs: 'Документы',
  scan: 'Сканирование',
  copy: 'Копирование',
};

function buildCategoryList(items) {
  const seen = new Map();

  items.forEach((item) => {
    const value = item.category || 'general';
    if (!seen.has(value)) {
      seen.set(value, CATEGORY_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1));
    }
  });

  const preferredOrder = ['photo', 'print', 'docs', 'scan', 'copy', 'general'];
  return [...seen.entries()]
    .sort((a, b) => {
      const ia = preferredOrder.indexOf(a[0]);
      const ib = preferredOrder.indexOf(b[0]);
      if (ia === -1 && ib === -1) return a[1].localeCompare(b[1], 'ru');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map(([value, label]) => ({ value, label }));
}

async function listPublicGallery(req, res) {
  const qRaw = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  const allItems = await GalleryItem.findAll({ order: [['order', 'ASC']], raw: true });
  // SQLite LIKE is case-insensitive only for ASCII; filter in JS so Cyrillic search works.
  const needle = qRaw.toLowerCase();
  const items = needle
    ? allItems.filter((item) =>
        [item.title, item.category, item.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
      )
    : allItems;

  res.render('gallery', {
    title: 'Галерея',
    items,
    categories: buildCategoryList(allItems),
    filters: { q: qRaw },
    activePage: 'gallery',
  });
}

async function getGalleryApi(req, res) {
  const items = await GalleryItem.findAll({ order: [['order', 'ASC']], raw: true });
  res.json(items);
}

function pickUpload(req, field) {
  const files = req.files && req.files[field];
  return Array.isArray(files) && files.length ? files[0] : null;
}

function resolveGalleryType(requestedType, mediaFile) {
  if (mediaFile && mediaFile.mimetype === 'video/mp4') return 'video';
  if (mediaFile && String(mediaFile.mimetype).startsWith('image/')) return 'image';
  const normalized = String(requestedType || '').trim();
  if (normalized === 'video' || normalized === 'image') return normalized;
  return 'image';
}

async function createGalleryItem(req, _res) {
  const { title, category, description, order, type } = req.body;
  const mediaFile = pickUpload(req, 'media');
  const posterFile = pickUpload(req, 'poster');
  const resolvedType = resolveGalleryType(type, mediaFile);

  if (!mediaFile || !mediaFile.filename) {
    const error = new Error('Файл галереи обязателен');
    error.status = 400;
    throw error;
  }

  return GalleryItem.create({
    title,
    category: category || 'general',
    description: description || '',
    type: resolvedType,
    url: `/uploads/gallery/${mediaFile.filename}`,
    thumbnail: posterFile ? `/uploads/gallery/${posterFile.filename}` : null,
    order: Number(order || 0),
  });
}

module.exports = {
  listPublicGallery,
  getGalleryApi,
  createGalleryItem,
  pickUpload,
  resolveGalleryType,
};

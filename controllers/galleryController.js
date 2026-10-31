const { GalleryItem } = require('../models');
const { filterByTerm } = require('../utils/search');

const CATEGORY_LABELS = {
  general: 'Общее',
  photo: 'Фото',
  print: 'Печать',
  docs: 'Документы',
  scan: 'Сканирование',
  copy: 'Копирование',
};

// Первая страница рендерится на сервере, остальное догружает /api/gallery.
const SSR_PAGE_SIZE = 12;
// Потолок limit для API: без него одним запросом можно выложить всю галерею.
const MAX_API_LIMIT = 48;

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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function queryGallery({ q = '', category = '', offset = 0, limit = SSR_PAGE_SIZE } = {}) {
  const allItems = await GalleryItem.findAll({ order: [['order', 'ASC']], raw: true });
  // Категории всегда считаем по всем работам: иначе чипы исчезают при фильтре.
  const categories = buildCategoryList(allItems);

  // SQLite LIKE не понимает регистр non-ASCII, поэтому фильтр и пагинация — в JS.
  const matched = filterByTerm(allItems, q, ['title', 'category', 'description']);
  const inCategory = category
    ? matched.filter((item) => (item.category || 'general') === category)
    : matched;

  return {
    items: inCategory.slice(offset, offset + limit),
    total: inCategory.length,
    allTotal: allItems.length,
    categories,
  };
}

async function listPublicGallery(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  const category =
    typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 40) : '';
  const requestedPage = Math.max(parsePositiveInt(req.query.page, 1), 1);

  let page = requestedPage;
  let result = await queryGallery({
    q,
    category,
    offset: (page - 1) * SSR_PAGE_SIZE,
    limit: SSR_PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(result.total / SSR_PAGE_SIZE));
  if (page > pageCount) {
    // ?page=999 не должен показывать пустую сетку: прижимаем к последней странице.
    page = pageCount;
    result = await queryGallery({
      q,
      category,
      offset: (page - 1) * SSR_PAGE_SIZE,
      limit: SSR_PAGE_SIZE,
    });
  }

  res.render('gallery', {
    title: 'Галерея',
    items: result.items,
    total: result.total,
    pageSize: SSR_PAGE_SIZE,
    page,
    pageCount,
    categories: result.categories,
    filters: { q, category, page },
    activePage: 'gallery',
  });
}

// Публичной галерее не нужны id, order и таймстемпы — отдаём только поля карточки.
function toPublicGalleryItem(item) {
  return {
    title: item.title,
    category: item.category || 'general',
    description: item.description || '',
    type: item.type || 'image',
    url: item.url,
    thumbnail: item.thumbnail || null,
    width: item.width ?? null,
    height: item.height ?? null,
  };
}

async function getGalleryApi(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  const category =
    typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 40) : '';
  const offset = parsePositiveInt(req.query.offset, 0);
  const limit = Math.min(parsePositiveInt(req.query.limit, SSR_PAGE_SIZE), MAX_API_LIMIT);
  const { items, total } = await queryGallery({ q, category, offset, limit });

  res.json({ items: items.map(toPublicGalleryItem), total });
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
    width: resolvedType === 'image' ? (mediaFile.width ?? null) : null,
    height: resolvedType === 'image' ? (mediaFile.height ?? null) : null,
    order: Number(order || 0),
  });
}

module.exports = {
  listPublicGallery,
  getGalleryApi,
  queryGallery,
  createGalleryItem,
  pickUpload,
  resolveGalleryType,
  SSR_PAGE_SIZE,
  MAX_API_LIMIT,
};

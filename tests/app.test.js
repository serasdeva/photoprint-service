process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `photoprint-test-${process.pid}.sqlite`);
process.env.DB_STORAGE = dbFile;
process.env.SESSION_DIR = path.join(os.tmpdir(), `photoprint-test-sessions-${process.pid}`);
fs.rmSync(dbFile, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');

const { buildAssets } = require('../tools/build-assets');
const { asset } = require('../utils/assets');

// Шаблоны берут адреса из манифеста, поэтому сборка нужна и при прямом запуске `node --test`.
buildAssets();

const { app, startApp } = require('../app');
const { sequelize, User, Service, GalleryItem, Order, Setting } = require('../models');
const { runMigrations } = require('../config/migrations');

let csrfToken;

function collectCookies(res, jar = {}) {
  const list = res.headers['set-cookie'] || [];
  list.forEach((raw) => {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  });
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

let sharedJar = null;

async function loginJar() {
  // Один вход на весь файл: иначе срабатывает rate limit логина (5 попыток на IP).
  if (sharedJar) {
    return sharedJar;
  }

  const jar = { csrf_token: csrfToken };
  const login = await request(app)
    .post('/admin/login')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .type('form')
    .send({ username: 'admin-test', password: 'Test1234!', _csrf: csrfToken });
  collectCookies(login, jar);
  assert.ok(jar.auth_token, 'auth cookie must be issued');
  sharedJar = jar;
  return jar;
}

before(async () => {
  await startApp();

  await User.create({
    username: 'admin-test',
    email: 'admin-test@example.com',
    passwordHash: await bcrypt.hash('Test1234!', 10),
    role: 'admin',
  });

  await Service.findOrCreate({
    where: { slug: 'test-service' },
    defaults: {
      title: 'Тестовая услуга',
      slug: 'test-service',
      description: 'Для проверки sitemap',
      price: 100,
      priceUnit: 'шт',
      icon: 'fa-print',
      order: 1,
      isActive: true,
    },
  });

  await GalleryItem.findOrCreate({
    where: { title: 'Тестовая работа' },
    defaults: {
      title: 'Тестовая работа',
      type: 'image',
      url: '/gallery-placeholders/sample-1.svg',
      category: 'photo',
      order: 1,
    },
  });

  const home = await request(app).get('/');
  assert.equal(home.status, 200);

  const jar = collectCookies(home);
  csrfToken = jar.csrf_token;
  assert.ok(csrfToken, 'CSRF cookie should be set on GET /');
});

after(async () => {
  await sequelize.close();
  [dbFile, `${dbFile}-wal`, `${dbFile}-shm`].forEach((file) => fs.rmSync(file, { force: true }));
  fs.rmSync(process.env.SESSION_DIR, { recursive: true, force: true });
});

test('GET / returns 200 with CSP header', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /class="hero home-hero"/);
  assert.match(res.text, /Как оформить заказ/);
  assert.match(res.text, /data-form="order"/);
  const csp = res.headers['content-security-policy'] || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
});

test('theme-color matches the light and dark palette on public and admin pages', async () => {
  const [home, login, themeJs] = await Promise.all([
    request(app).get('/'),
    request(app).get('/admin/login'),
    request(app).get('/js/theme.js'),
  ]);

  assert.equal(login.status, 200);
  assert.match(home.text, /<meta name="theme-color" content="#faf7f2" \/>/);
  assert.match(home.text, /media="\(prefers-color-scheme: dark\)" content="#171513"/);
  assert.match(login.text, /<meta name="theme-color" content="#f7f4f8" \/>/);
  assert.match(login.text, /media="\(prefers-color-scheme: dark\)" content="#17131b"/);
  // Медиазапросы не знают о ручном переключателе, поэтому JS подменяет цвет на текущий.
  assert.match(themeJs.text, /removeAttribute\('media'\)/);
});

test('GET /contacts renders the responsive order form', async () => {
  const res = await request(app).get('/contacts');
  assert.equal(res.status, 200);
  assert.match(res.text, /href="tel:\+7\d+"/);
  assert.match(res.text, /data-form="order"/);
  assert.match(res.text, /data-phone-mask/);
});

test('GET /services, service details and /gallery preserve their public flows', async () => {
  const [services, service, gallery] = await Promise.all([
    request(app).get('/services'),
    request(app).get('/services/test-service'),
    request(app).get('/gallery'),
  ]);

  assert.equal(services.status, 200);
  assert.match(services.text, /class="page-hero service-list-hero"/);
  assert.equal(service.status, 200);
  assert.match(service.text, /class="[^"]*service-order-card/);
  assert.match(service.text, /data-form="order"/);
  assert.equal(gallery.status, 200);
  assert.match(gallery.text, /data-gallery-grid/);
  assert.match(gallery.text, /data-filter="all"/);
});

test('rebuilt home page exposes new UX blocks without breaking legacy hooks', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /id="home-services"/);
  assert.match(res.text, /data-services-search/);
  assert.match(res.text, /data-services-grid/);
  assert.match(res.text, /Отзывы/);
  assert.match(res.text, /Частые вопросы/);
  assert.match(res.text, /data-faq/);
  assert.match(res.text, /id="order-form"/);
  assert.match(res.text, /id="sticky-cta"/);
  assert.match(res.text, /aria-current="page"/);
  assert.match(res.text, /application\/ld\+json/);
  assert.match(res.text, /data-phone-mask/);
  assert.match(res.text, /data-char-count/);
});

test('public search on services and gallery filters via query param', async () => {
  const [noMatchServices, matchServices, noMatchGallery, matchGallery] = await Promise.all([
    request(app).get('/services?q=__no_such_service__'),
    // lowercase query must match mixed-case Cyrillic titles (SQLite LIKE is ASCII-only)
    request(app).get('/services?q=тестовая'),
    request(app).get('/gallery?q=__no_such_item__'),
    request(app).get('/gallery?q=тестовая'),
  ]);
  assert.equal(noMatchServices.status, 200);
  assert.match(noMatchServices.text, /Ничего не нашли/);
  assert.equal(matchServices.status, 200);
  assert.match(matchServices.text, /Тестовая услуга/);
  assert.equal(noMatchGallery.status, 200);
  assert.match(noMatchGallery.text, /Ничего не нашли/);
  assert.equal(matchGallery.status, 200);
  assert.match(matchGallery.text, /Тестовая работа/);
});

test('GET /unknown renders 404 page', async () => {
  const res = await request(app).get('/definitely-missing-page');
  assert.equal(res.status, 404);
});

test('GET /privacy renders privacy page', async () => {
  const res = await request(app).get('/privacy');
  assert.equal(res.status, 200);
  assert.match(res.text, /Политика конфиденциальности/);
  assert.match(res.text, /class="card privacy-content"/);
});

test('GET /sitemap.xml includes static and service URLs', async () => {
  const res = await request(app).get('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/privacy/);
  assert.match(res.text, /\/services\/test-service/);
  // У услуг должен быть lastmod из updatedAt, иначе поисковики не видят свежести.
  assert.match(
    res.text,
    /<loc>[^<]*\/services\/test-service<\/loc><lastmod>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/lastmod>/
  );
});

test('service meta description is truncated to 160 characters at a word boundary', async () => {
  const longDescription = `${'Очень длинное описание услуги печати фотографий. '.repeat(8)}Конец.`;
  const slug = `meta-long-${Date.now()}`;
  await Service.create({
    title: 'Длинное описание',
    slug,
    description: longDescription,
    price: 10,
    priceUnit: 'шт',
    icon: 'fa-print',
    order: 99,
    isActive: true,
  });

  const res = await request(app).get(`/services/${slug}`);
  assert.equal(res.status, 200);
  const meta = res.text.match(/<meta name="description" content="([^"]*)" \/>/);
  assert.ok(meta, 'meta description should be rendered');
  const value = meta[1];
  assert.ok(value.length <= 160, `meta description is ${value.length} chars, expected <= 160`);
  assert.ok(value.endsWith('…'), 'truncated description should end with an ellipsis');
  assert.ok(!value.includes('  '), 'whitespace should be collapsed');

  // Короткое описание не трогаем.
  const short = await request(app).get('/services/test-service');
  assert.match(short.text, /<meta name="description" content="Для проверки sitemap" \/>/);
});

test('POST /api/orders without CSRF token is rejected', async () => {
  const res = await request(app)
    .post('/api/orders')
    .set('Cookie', `csrf_token=${csrfToken}`)
    .send({ name: 'Иван', phone: '+7 900 000-00-00' });
  assert.equal(res.status, 403);
});

test('POST /api/orders with CSRF token creates an order', async () => {
  const res = await request(app)
    .post('/api/orders')
    .set('Cookie', `csrf_token=${csrfToken}`)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Иван', phone: '+7 900 000-00-00', message: 'Тестовая заявка' });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.order, undefined, 'response must not expose order record');
});

test('POST /api/orders with honeypot filled is rejected', async () => {
  const res = await request(app)
    .post('/api/orders')
    .set('Cookie', `csrf_token=${csrfToken}`)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Бот', phone: '+7 900 000-00-01', website: 'spam.example' });

  assert.equal(res.status, 400);
});

test('POST /api/orders with invalid payload returns validation errors', async () => {
  const res = await request(app)
    .post('/api/orders')
    .set('Cookie', `csrf_token=${csrfToken}`)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'И', phone: '' });

  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.errors));
  assert.ok(res.body.errors.length >= 2);
});

test('GET /admin without session redirects to login', async () => {
  const res = await request(app).get('/admin');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/admin\/login/);
});

test('POST /admin/login without CSRF token does not authenticate', async () => {
  const jar = { csrf_token: csrfToken };
  const res = await request(app)
    .post('/admin/login')
    .set('Cookie', cookieHeader(jar))
    .set('Referer', '/admin/login')
    .set('Accept', 'text/html')
    .type('form')
    .send({ username: 'admin-test', password: 'Test1234!' });

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/admin/login');
  collectCookies(res, jar);
  const authCookie = jar.auth_token;
  assert.equal(authCookie, undefined, 'auth cookie must not be issued');

  const sessionJar = collectCookies(res);
  const loginPage = await request(app).get('/admin/login').set('Cookie', cookieHeader(sessionJar));
  assert.match(loginPage.text, /Недействительный токен формы/, 'CSRF failure flash must render');
});

test('CSRF failure does not redirect to an external Referer', async () => {
  const external = await request(app)
    .post('/admin/settings')
    .set('Cookie', `csrf_token=${csrfToken}`)
    .set('Accept', 'text/html')
    .set('Referer', 'https://evil.example/phish')
    .type('form')
    .send({ siteName: 'взлом' });

  assert.equal(external.status, 302);
  assert.equal(external.headers.location, '/admin/settings', 'external Referer must be ignored');

  const protocolRelative = await request(app)
    .post('/admin/settings')
    .set('Cookie', `csrf_token=${csrfToken}`)
    .set('Accept', 'text/html')
    .set('Referer', '//evil.example/phish')
    .type('form')
    .send({ siteName: 'взлом' });

  assert.equal(
    protocolRelative.headers.location,
    '/admin/settings',
    'protocol-relative Referer must be ignored'
  );
});

test('CSRF failure keeps a same-origin Referer page', async () => {
  const res = await request(app)
    .post('/admin/settings')
    .set('Cookie', `csrf_token=${csrfToken}`)
    .set('Accept', 'text/html')
    .set('Host', 'example.test')
    .set('Referer', 'http://example.test/admin/settings?tab=main')
    .type('form')
    .send({ siteName: 'взлом' });

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/admin/settings?tab=main');
});

test('admin login, logout and token revocation flow', async () => {
  const jar = { csrf_token: csrfToken };

  const login = await request(app)
    .post('/admin/login')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .type('form')
    .send({ username: 'admin-test', password: 'Test1234!', _csrf: csrfToken });

  assert.equal(login.status, 302);
  assert.match(login.headers.location, /\/admin/);
  collectCookies(login, jar);
  assert.ok(jar.auth_token, 'auth cookie must be issued');

  const dashboard = await request(app).get('/admin').set('Cookie', cookieHeader(jar));
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Добро пожаловать/, 'success flash must render on dashboard');

  const logout = await request(app)
    .post('/admin/logout')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .type('form')
    .send({ _csrf: csrfToken });
  assert.equal(logout.status, 302);

  const afterLogout = await request(app).get('/admin').set('Cookie', cookieHeader(jar));
  assert.equal(afterLogout.status, 302);
  assert.match(afterLogout.headers.location, /\/admin\/login/);
});

test('admin dashboard surfaces new orders with contact and quick status actions', async () => {
  const order = await Order.create({
    name: 'Клиент дашборда',
    phone: '+7 900 111-22-33',
    email: 'client@example.com',
    service: 'Фото 10x15',
    message: 'Проверка быстрых действий',
  });
  const jar = await loginJar();

  try {
    const dashboard = await request(app).get('/admin').set('Cookie', cookieHeader(jar));
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.text, /Новые заявки/);
    assert.match(dashboard.text, /tel:\+79001112233/);
    assert.match(dashboard.text, /mailto:client@example\.com/);
    assert.match(dashboard.text, new RegExp(`/admin/orders/${order.id}/status`));

    const orders = await request(app).get('/admin/orders').set('Cookie', cookieHeader(jar));
    assert.equal(orders.status, 200);
    assert.match(orders.text, /href="tel:\+79001112233"/);
    assert.match(orders.text, /href="mailto:client@example\.com"/);

    const settings = await request(app).get('/admin/settings').set('Cookie', cookieHeader(jar));
    assert.equal(settings.status, 200);
    assert.match(settings.text, /data-settings-preview-title/);
    assert.match(settings.text, /data-settings-preview-subtitle/);

    const updated = await request(app)
      .post(`/admin/orders/${order.id}/status`)
      .set('Cookie', cookieHeader(jar))
      .type('form')
      .send({ _csrf: csrfToken, status: 'in_progress' });
    assert.equal(updated.status, 302);
    assert.equal((await order.reload()).status, 'in_progress');
  } finally {
    await order.destroy();
  }
});

test('admin catalog search and pagination preserve filters', async () => {
  const services = await Promise.all(
    Array.from({ length: 21 }, (_, index) =>
      Service.create({
        title: `Пагинация ${index}`,
        slug: `pagination-${Date.now()}-${index}`,
        description: 'Тестовый элемент',
        price: 1,
        priceUnit: 'шт',
        icon: 'fa-print',
        order: index,
        isActive: true,
      })
    )
  );
  const galleryItems = await Promise.all(
    Array.from({ length: 21 }, (_, index) =>
      GalleryItem.create({
        title: `Пагинация ${index}`,
        type: 'image',
        url: '/gallery-placeholders/sample-1.svg',
        category: 'pagination',
        description: 'Тестовый элемент',
        order: index,
      })
    )
  );
  const jar = await loginJar();

  try {
    const servicesPage = await request(app)
      .get('/admin/services?q=Pagin&page=2')
      .set('Cookie', cookieHeader(jar));
    assert.equal(servicesPage.status, 200);
    assert.match(servicesPage.text, /Стр\. 2 из 2/);
    assert.match(servicesPage.text, /q=Pagin&amp;page=1/);

    const galleryPage = await request(app)
      .get('/admin/gallery?q=Pagin&page=2')
      .set('Cookie', cookieHeader(jar));
    assert.equal(galleryPage.status, 200);
    assert.match(galleryPage.text, /Стр\. 2 из 2/);
    assert.match(galleryPage.text, /q=Pagin&amp;page=1/);
  } finally {
    await Promise.all(services.map((service) => service.destroy()));
    await Promise.all(galleryItems.map((item) => item.destroy()));
  }
});

test('multipart admin form requires CSRF token (regression)', async () => {
  const jar = await loginJar();
  const title = `Мультимедийная услуга ${Date.now()}`;

  const rejected = await request(app)
    .post('/admin/services')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .field('title', title)
    .field('price', '10');
  assert.equal(rejected.status, 302);
  assert.equal(
    await Service.findOne({ where: { title } }),
    null,
    'service must not be created without CSRF token'
  );

  const accepted = await request(app)
    .post('/admin/services')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .field('_csrf', csrfToken)
    .field('title', title)
    .field('description', 'создано тестом')
    .field('price', '10')
    .field('isActive', 'on');
  assert.equal(accepted.status, 302);
  assert.match(accepted.headers.location, /\/admin\/services/);

  const created = await Service.findOne({ where: { title } });
  assert.ok(created, 'service must be created with valid CSRF token');
  await created.destroy();
});

test('admin uploads files, rejects wrong types, oversized posters and videos', async () => {
  const jar = await loginJar();
  const uploadsRoot = path.join(__dirname, '..', 'public');
  const diskPath = (url) => path.join(uploadsRoot, url.replace(/^\//, ''));
  const createdFiles = [];
  const serviceTitle = `Услуга с картинкой ${Date.now()}`;
  const badServiceTitle = `Услуга с svg ${Date.now()}`;
  const galleryTitle = `Работа с постером ${Date.now()}`;
  const bigTitle = `Постер слишком большой ${Date.now()}`;
  const bigVideoTitle = `Видео слишком большое ${Date.now()}`;
  const badTitle = `Плохой тип ${Date.now()}`;
  // Настоящий PNG 1×1: фильтр проверяет расширение и MIME, но валидный файл честнее.
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  try {
    const serviceRes = await request(app)
      .post('/admin/services')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', serviceTitle)
      .field('description', 'загружено тестом')
      .field('price', '10')
      .field('isActive', 'on')
      .attach('image', PNG_1X1, { filename: 'cup.png', contentType: 'image/png' });

    assert.equal(serviceRes.status, 302);
    const service = await Service.findOne({ where: { title: serviceTitle } });
    assert.ok(service, 'service with uploaded image must be created');
    assert.match(service.image, /^\/uploads\/services\/[\w.-]+\.webp$/);
    createdFiles.push(diskPath(service.image));
    assert.ok(fs.existsSync(createdFiles.at(-1)), 'uploaded service image must exist on disk');

    const galleryRes = await request(app)
      .post('/admin/gallery')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', galleryTitle)
      .field('category', 'photo')
      .attach('media', Buffer.from('not-a-real-video'), {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      })
      .attach('poster', PNG_1X1, { filename: 'poster.png', contentType: 'image/png' });

    assert.equal(galleryRes.status, 302);
    const item = await GalleryItem.findOne({ where: { title: galleryTitle } });
    assert.ok(item, 'gallery item with video and poster must be created');
    assert.equal(item.type, 'video');
    assert.match(item.url, /^\/uploads\/gallery\/[\w.-]+\.mp4$/);
    assert.match(item.thumbnail, /^\/uploads\/gallery\/[\w.-]+\.webp$/);
    createdFiles.push(diskPath(item.url), diskPath(item.thumbnail));
    assert.ok(fs.existsSync(diskPath(item.thumbnail)), 'uploaded poster must exist on disk');

    const badService = await request(app)
      .post('/admin/services')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', badServiceTitle)
      .attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        filename: 'icon.svg',
        contentType: 'image/svg+xml',
      });
    assert.equal(badService.status, 302);
    assert.match(badService.headers.location, /\/admin\/services\/new/);
    assert.equal(await Service.findOne({ where: { title: badServiceTitle } }), null);

    const wrongType = await request(app)
      .post('/admin/gallery')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', badTitle)
      .attach('media', Buffer.from('MZ'), {
        filename: 'setup.exe',
        contentType: 'application/octet-stream',
      });
    assert.equal(wrongType.status, 302);
    assert.match(wrongType.headers.location, /\/admin\/gallery\/new/);

    const galleryDir = path.join(uploadsRoot, 'uploads', 'gallery');
    const filesBefore = fs.readdirSync(galleryDir).sort();
    const bigPoster = await request(app)
      .post('/admin/gallery')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', bigTitle)
      .attach('media', Buffer.from('video-bytes'), {
        filename: 'big.mp4',
        contentType: 'video/mp4',
      })
      .attach('poster', Buffer.alloc(8 * 1024 * 1024 + 1), {
        filename: 'big.png',
        contentType: 'image/png',
      });

    assert.equal(bigPoster.status, 302);
    assert.match(bigPoster.headers.location, /\/admin\/gallery\/new/);
    assert.equal(await GalleryItem.findOne({ where: { title: bigTitle } }), null);

    collectCookies(bigPoster, jar);
    const form = await request(app).get('/admin/gallery/new').set('Cookie', cookieHeader(jar));
    assert.match(form.text, /Постер больше 8 МБ/);

    // Отклонённые файлы удаляются асинхронно, поэтому дожидаемся очистки каталога.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (fs.readdirSync(galleryDir).sort().join('|') === filesBefore.join('|')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(
      fs.readdirSync(galleryDir).sort(),
      filesBefore,
      'rejected poster and video must be removed from disk'
    );

    // Общий лимит запроса: multer сам обрывает файл на 25 МБ ещё до проверок роутов.
    const bigVideo = await request(app)
      .post('/admin/gallery')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', bigVideoTitle)
      .attach('media', Buffer.alloc(25 * 1024 * 1024 + 1), {
        filename: 'huge.mp4',
        contentType: 'video/mp4',
      });

    assert.equal(bigVideo.status, 302);
    assert.match(bigVideo.headers.location, /\/admin\/gallery\/new/);
    assert.equal(await GalleryItem.findOne({ where: { title: bigVideoTitle } }), null);

    collectCookies(bigVideo, jar);
    const videoForm = await request(app).get('/admin/gallery/new').set('Cookie', cookieHeader(jar));
    assert.match(videoForm.text, /Файл больше 25 МБ/, 'admin must see a Russian size message');

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (fs.readdirSync(galleryDir).sort().join('|') === filesBefore.join('|')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(
      fs.readdirSync(galleryDir).sort(),
      filesBefore,
      'multer must remove the partial video it aborted'
    );
  } finally {
    await Service.destroy({ where: { title: [serviceTitle, badServiceTitle] } });
    await GalleryItem.destroy({
      where: { title: [galleryTitle, bigTitle, bigVideoTitle, badTitle] },
    });
    createdFiles.forEach((file) => fs.rmSync(file, { force: true }));
  }
});

test('admin form validation rejects invalid service payload', async () => {
  const jar = await loginJar();
  const title = `Черновик услуги ${Date.now()}`;

  const res = await request(app)
    .post('/admin/services')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .field('_csrf', csrfToken)
    .field('title', title)
    .field('price', 'не число');

  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/admin\/services\/new/);
  assert.equal(await Service.findOne({ where: { title } }), null);

  collectCookies(res, jar);
  const form = await request(app).get('/admin/services/new').set('Cookie', cookieHeader(jar));
  assert.equal(form.status, 200);
  assert.match(form.text, new RegExp(`id="f-title" name="title" value="${title}"`));
  assert.match(form.text, /value="не число"/);
  assert.match(form.text, /id="f-icon"[^>]*list="icon-options"/);
  assert.match(form.text, /<datalist id="icon-options">/);
  assert.match(form.text, /<option value="fa-print"><\/option>/);
  assert.match(form.text, /<option value="fa-file-image"><\/option>/);
  assert.doesNotMatch(
    form.text,
    /<option value="fa-image"><\/option>/,
    'regular-only icon must not be suggested for the solid service icon'
  );

  const galleryTitle = `Черновик галереи ${Date.now()}`;
  const galleryRes = await request(app)
    .post('/admin/gallery')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .field('_csrf', csrfToken)
    .field('title', galleryTitle)
    .field('category', 'family photos')
    .field('order', '-1');

  assert.equal(galleryRes.status, 302);
  assert.match(galleryRes.headers.location, /\/admin\/gallery\/new/);
  collectCookies(galleryRes, jar);
  const galleryForm = await request(app).get('/admin/gallery/new').set('Cookie', cookieHeader(jar));
  assert.equal(galleryForm.status, 200);
  assert.match(galleryForm.text, new RegExp(`id="g-title" name="title" value="${galleryTitle}"`));
  assert.match(galleryForm.text, /id="g-category" name="category"[^>]*value="family photos"/);
});

test('inactive services are hidden from the public site and sitemap', async () => {
  const hidden = await Service.create({
    title: 'Черновик услуги',
    slug: 'hidden-draft-service',
    description: 'Ещё не опубликовано',
    price: 1,
    priceUnit: 'шт',
    icon: 'fa-print',
    order: 99,
    isActive: false,
  });

  try {
    const page = await request(app).get('/services/hidden-draft-service');
    assert.equal(page.status, 404, 'inactive service must not be reachable by direct URL');

    const sitemap = await request(app).get('/sitemap.xml');
    assert.doesNotMatch(sitemap.text, /hidden-draft-service/);
    assert.match(sitemap.text, /\/services\/test-service/);
  } finally {
    await hidden.destroy();
  }
});

test('admin catalog search matches Cyrillic regardless of case', async () => {
  const jar = await loginJar();

  const servicesPage = await request(app)
    .get('/admin/services?q=тестовая')
    .set('Cookie', cookieHeader(jar));
  assert.equal(servicesPage.status, 200);
  assert.match(
    servicesPage.text,
    /Тестовая услуга/,
    'lowercase Cyrillic query must find the title'
  );

  const galleryPage = await request(app)
    .get('/admin/gallery?q=тестовая')
    .set('Cookie', cookieHeader(jar));
  assert.equal(galleryPage.status, 200);
  assert.match(galleryPage.text, /Тестовая работа/);
});

test('admin order search matches Cyrillic regardless of case', async () => {
  const order = await Order.create({
    name: 'Мария Петрова',
    phone: '+7 900 222-33-44',
    service: 'Фотопечать',
    message: 'Проверка поиска',
  });
  const jar = await loginJar();

  try {
    const res = await request(app).get('/admin/orders?q=мария').set('Cookie', cookieHeader(jar));
    assert.equal(res.status, 200);
    assert.match(res.text, /Мария Петрова/);
  } finally {
    await order.destroy();
  }
});

test('admin orders filter by creation date with inclusive day boundaries', async () => {
  const jar = await loginJar();
  const created = await Promise.all([
    Order.create({
      name: 'Диапазон Январь',
      phone: '+7 900 000-00-01',
      createdAt: new Date(2026, 0, 10, 12, 0),
    }),
    Order.create({
      name: 'Диапазон Февраль',
      phone: '+7 900 000-00-02',
      createdAt: new Date(2026, 1, 15, 12, 0),
    }),
    Order.create({
      name: 'Диапазон Март',
      phone: '+7 900 000-00-03',
      createdAt: new Date(2026, 2, 5, 12, 0),
    }),
  ]);

  const list = (query) =>
    request(app).get(`/admin/orders?${query}`).set('Cookie', cookieHeader(jar));

  try {
    const all = await list('q=Диапазон');
    assert.equal(all.status, 200);
    for (const order of created) {
      assert.ok(all.text.includes(order.name), `${order.name} must be in the unfiltered list`);
    }

    const february = await list('q=Диапазон&from=2026-02-01&to=2026-02-15');
    assert.ok(february.text.includes('Диапазон Февраль'));
    assert.ok(!february.text.includes('Диапазон Январь'), 'from must exclude earlier days');
    assert.ok(!february.text.includes('Диапазон Март'), 'to must exclude later days');
    assert.match(february.text, /name="from" value="2026-02-01"/);
    assert.match(february.text, /name="to" value="2026-02-15"/);
    assert.match(
      february.text,
      /href="\/admin\/orders\/export\?[^"]*from=2026-02-01[^"]*to=2026-02-15/,
      'CSV export must keep the date filters'
    );

    const singleDay = await list('q=Диапазон&from=2026-02-15&to=2026-02-15');
    assert.ok(singleDay.text.includes('Диапазон Февраль'), 'both bounds include the whole day');
    assert.ok(!singleDay.text.includes('Диапазон Январь'));
    assert.ok(!singleDay.text.includes('Диапазон Март'));

    const invalid = await list('q=Диапазон&from=2026-02-31&to=abc');
    for (const order of created) {
      assert.ok(invalid.text.includes(order.name), 'invalid dates are ignored, not fatal');
    }
    assert.doesNotMatch(invalid.text, /value="2026-02-31"/);

    const swapped = await list('q=Диапазон&from=2026-03-01&to=2026-02-01');
    assert.ok(swapped.text.includes('Диапазон Февраль'), 'reversed bounds are swapped');
    assert.ok(!swapped.text.includes('Диапазон Март'));
    assert.match(swapped.text, /name="from" value="2026-02-01"/);
    assert.match(swapped.text, /name="to" value="2026-03-01"/);

    const exported = await request(app)
      .get('/admin/orders/export?q=Диапазон&from=2026-02-01&to=2026-02-15')
      .set('Cookie', cookieHeader(jar));
    assert.equal(exported.status, 200);
    assert.ok(exported.text.includes('Диапазон Февраль'));
    assert.ok(!exported.text.includes('Диапазон Январь'));
    assert.ok(!exported.text.includes('Диапазон Март'));
  } finally {
    await Promise.all(created.map((order) => order.destroy()));
  }
});

test('admin order page shows the full order and returns there after a status change', async () => {
  const order = await Order.create({
    name: 'Подробная заявка',
    phone: '+7 900 777-88-99',
    email: 'detail@example.com',
    service: 'Сканирование',
    message: 'Строка один\nСтрока два',
    source: 'telegram',
    telegramChatId: '123456789',
  });
  const jar = await loginJar();

  try {
    const missing = await request(app).get('/admin/orders/999999').set('Cookie', cookieHeader(jar));
    assert.equal(missing.status, 302);
    assert.equal(missing.headers.location, '/admin/orders');

    const page = await request(app)
      .get(`/admin/orders/${order.id}`)
      .set('Cookie', cookieHeader(jar));
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(`Заявка #${order.id}`));
    assert.match(page.text, /Подробная заявка/);
    assert.match(page.text, /href="tel:\+79007778899"/);
    assert.match(page.text, /href="mailto:detail@example\.com"/);
    assert.match(page.text, /Сканирование/);
    assert.ok(page.text.includes('Строка один\nСтрока два'), 'message keeps its line breaks');
    assert.match(page.text, /Telegram-бот/);
    assert.match(page.text, /123456789/);
    assert.match(page.text, new RegExp(`/admin/orders/${order.id}/status`));
    assert.match(
      page.text,
      new RegExp(`name="returnTo" value="/admin/orders/${order.id}"`),
      'status form must bring the admin back to the detail page'
    );
    assert.match(page.text, new RegExp(`/admin/orders/${order.id}/delete`));

    const updated = await request(app)
      .post(`/admin/orders/${order.id}/status`)
      .set('Cookie', cookieHeader(jar))
      .type('form')
      .send({ _csrf: csrfToken, status: 'done', returnTo: `/admin/orders/${order.id}` });
    assert.equal(updated.status, 302);
    assert.equal(updated.headers.location, `/admin/orders/${order.id}`);
    assert.equal((await order.reload()).status, 'done');

    const after = await request(app)
      .get(`/admin/orders/${order.id}`)
      .set('Cookie', cookieHeader(jar));
    assert.match(after.text, /badge-done/);

    const spoofed = await request(app)
      .post(`/admin/orders/${order.id}/status`)
      .set('Cookie', cookieHeader(jar))
      .type('form')
      .send({ _csrf: csrfToken, status: 'new', returnTo: 'https://evil.example' });
    assert.equal(spoofed.headers.location, '/admin/orders', 'only local order paths are allowed');
  } finally {
    await order.destroy();
  }
});

test('admin exports orders to CSV with the same filters as the list', async () => {
  const doneOrder = await Order.create({
    name: 'Иван Смирнов',
    phone: '+7 900 111-22-33',
    email: 'ivan@example.com',
    service: 'Печать фото',
    message: 'Нужно 20 шт, срочно',
    status: 'done',
    source: 'site',
  });
  const newOrder = await Order.create({
    name: '=HYPERLINK("http://evil.example")',
    phone: '+7 900 444-55-66',
    service: 'Сканирование',
    message: 'строка1\nстрока2',
    status: 'new',
    source: 'telegram',
  });
  const jar = await loginJar();

  try {
    const denied = await request(app).get('/admin/orders/export');
    assert.equal(denied.status, 302, 'export must stay behind the admin login');

    const res = await request(app)
      .get('/admin/orders/export?status=done&q=Смирнов')
      .set('Cookie', cookieHeader(jar));
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/i);
    assert.match(res.headers['content-type'], /utf-8/i);
    assert.match(
      res.headers['content-disposition'],
      /^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/,
      'download must carry a dated ASCII filename'
    );

    const body = res.text;
    assert.ok(body.startsWith('﻿'), 'BOM, otherwise Excel shows Cyrillic as mojibake');

    const [, ...dataLines] = body.slice(1).trimEnd().split('\r\n');
    assert.equal(dataLines.length, 1, 'status and q filters must apply to the export too');

    // Разбирать строку по запятой нельзя: внутри quoted-поля тоже есть запятая.
    const row = dataLines[0];
    assert.ok(row.startsWith(`${doneOrder.id},`), 'id comes first');
    assert.match(row, /,\d{4}-\d{2}-\d{2} \d{2}:\d{2},/, 'sortable date-time column');
    assert.ok(row.includes('Иван Смирнов'));
    assert.ok(
      row.includes(",'+7 900 111-22-33,"),
      'a value starting with + is a formula trigger, so it gets an apostrophe (invisible in Excel)'
    );
    assert.ok(row.includes('ivan@example.com'));
    assert.ok(row.includes('"Нужно 20 шт, срочно"'), 'comma inside a value must be quoted');
    assert.ok(row.endsWith(',done,site'), 'status and source are the last columns');

    const escaped = await request(app)
      .get('/admin/orders/export?q=HYPERLINK')
      .set('Cookie', cookieHeader(jar));
    assert.equal(escaped.status, 200);
    assert.ok(
      escaped.text.includes(`'=HYPERLINK(""http://evil.example"")`),
      'formula-looking input must be neutralised and inner quotes doubled'
    );
    assert.ok(
      escaped.text.includes('"строка1\nстрока2"'),
      'a newline inside a value must stay quoted so the row does not break'
    );
    assert.match(escaped.text, /,new,telegram\r?\n$/, 'source column distinguishes bot orders');
  } finally {
    await Promise.all([doneOrder.destroy(), newOrder.destroy()]);
  }
});

test('search URLs keep a clean canonical and are marked noindex', async () => {
  const res = await request(app).get('/services?q=тест');
  assert.equal(res.status, 200);
  assert.match(res.text, /rel="canonical" href="http:\/\/localhost:3000\/services"/);
  assert.doesNotMatch(res.text, /rel="canonical" href="[^"]*\?/);
  assert.match(res.text, /<meta name="robots" content="noindex, follow" \/>/);
});

test('robots.txt keeps admin and api out of the index', async () => {
  const res = await request(app).get('/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.text, /Disallow: \/admin/);
  assert.match(res.text, /Disallow: \/api/);
});

test('social preview tags point to a committed 1200x630 raster image', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /property="og:image" content="http:\/\/localhost:3000\/og-image\.png"/);
  assert.match(res.text, /property="og:image:width" content="1200"/);
  assert.match(res.text, /property="og:image:height" content="630"/);
  assert.match(res.text, /name="twitter:card" content="summary_large_image"/);
  assert.match(res.text, /name="twitter:image" content="http:\/\/localhost:3000\/og-image\.png"/);
  assert.doesNotMatch(res.text, /property="og:image" content="[^"]*\.svg"/);

  const asset = path.join(__dirname, '..', 'public', 'og-image.png');
  assert.ok(fs.existsSync(asset), 'public/og-image.png must be committed');
  assert.ok(fs.statSync(asset).size > 20 * 1024, 'og-image must not be a placeholder');
});

test('service page uses its own photo for social previews', async () => {
  const suffix = Date.now();
  const raster = await Service.create({
    title: 'Печать на кружке',
    slug: `og-raster-${suffix}`,
    description: 'Тестовая услуга',
    price: 1,
    priceUnit: 'шт',
    image: '/uploads/services/mug.png',
    isActive: true,
  });
  // SVG соцсети в превью не показывают, поэтому такая услуга остаётся на дефолтной карточке.
  const vector = await Service.create({
    title: 'Без растровой картинки',
    slug: `og-vector-${suffix}`,
    description: 'Тестовая услуга',
    price: 1,
    priceUnit: 'шт',
    image: '/uploads/services/service-default.svg',
    isActive: true,
  });
  const traversal = await Service.create({
    title: 'Обратный путь',
    slug: `og-traversal-${suffix}`,
    description: 'Тестовая услуга',
    price: 1,
    priceUnit: 'шт',
    image: '/uploads/services/../../secret.png',
    isActive: true,
  });

  try {
    const res = await request(app).get(`/services/${raster.slug}`);
    assert.equal(res.status, 200);
    assert.match(
      res.text,
      /property="og:image" content="http:\/\/localhost:3000\/uploads\/services\/mug\.png"/
    );
    // Габариты загруженного файла неизвестны, поэтому врать про 1200×630 не будем.
    assert.doesNotMatch(res.text, /property="og:image:width"/);
    assert.match(res.text, /property="og:image:alt" content="Печать на кружке"/);
    assert.match(
      res.text,
      /name="twitter:image" content="http:\/\/localhost:3000\/uploads\/services\/mug\.png"/
    );

    const fallback = await request(app).get(`/services/${vector.slug}`);
    assert.equal(fallback.status, 200);
    assert.match(
      fallback.text,
      /property="og:image" content="http:\/\/localhost:3000\/og-image\.png"/
    );
    assert.match(fallback.text, /property="og:image:width" content="1200"/);

    // `..` в поле картинки не должен превращать og:image в ссылку на чужой путь.
    const sneaky = await request(app).get(`/services/${traversal.slug}`);
    assert.equal(sneaky.status, 200);
    assert.match(
      sneaky.text,
      /property="og:image" content="http:\/\/localhost:3000\/og-image\.png"/
    );
    assert.doesNotMatch(sneaky.text, /og:image" content="[^"]*secret/);
  } finally {
    await raster.destroy();
    await vector.destroy();
    await traversal.destroy();
  }
});

test('Font Awesome is self-hosted and no CDN is referenced', async () => {
  const vendor = path.join(__dirname, '..', 'public', 'vendor', 'fontawesome');
  assert.ok(fs.existsSync(path.join(vendor, 'icons.css')), 'icons.css must be built and committed');
  for (const font of ['fa-solid-900.woff2', 'fa-regular-400.woff2', 'fa-brands-400.woff2']) {
    assert.ok(fs.existsSync(path.join(vendor, 'webfonts', font)), `${font} must be committed`);
  }

  for (const page of ['/', '/contacts', '/admin/login']) {
    const res = await request(app).get(page);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(`href="${asset('/vendor/fontawesome/icons.css')}"`));
    assert.doesNotMatch(res.text, /cdnjs\.cloudflare\.com/);
    assert.match(res.text, /class="fa-solid fa-print"/);
  }

  const csp = (await request(app).get('/')).headers['content-security-policy'] || '';
  assert.doesNotMatch(csp, /cdnjs\.cloudflare\.com/);
});

test('every Font Awesome icon in markup exists in the local subset with its style', () => {
  const root = path.join(__dirname, '..');
  const styleClasses = new Set(['fa-solid', 'fa-regular', 'fa-brands']);
  const fontFileTokens = new Set(['fa-solid-900']);

  const collectFiles = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectFiles(target);
      return /\.(ejs|js)$/.test(entry.name) ? [target] : [];
    });

  const literals = new Set();
  const pairs = new Set();

  for (const file of [
    ...collectFiles(path.join(root, 'views')),
    ...collectFiles(path.join(root, 'public/js')),
  ]) {
    const source = fs.readFileSync(file, 'utf8');

    for (const match of source.matchAll(/(?<![\w-])fa-[a-z0-9-]+\b/g)) {
      if (styleClasses.has(match[0]) || fontFileTokens.has(match[0])) continue;
      literals.add(match[0].slice(3));
    }

    for (const classValue of source.matchAll(
      /(?:class|className)\s*=\s*["'`]([^"'`]*fa-[^"'`]*)["'`]/g
    )) {
      const tokens = classValue[1].split(/\s+/);
      const styleToken = tokens.find((token) => styleClasses.has(token));
      if (!styleToken) continue;

      tokens
        .filter((token) => /^fa-[a-z0-9-]+$/.test(token) && !styleClasses.has(token))
        .forEach((token) => pairs.add(`${styleToken.slice(3)} ${token.slice(3)}`));
    }
  }

  const iconsCss = fs.readFileSync(path.join(root, 'public/vendor/fontawesome/icons.css'), 'utf8');
  const cssIcons = new Set([...iconsCss.matchAll(/\.fa-([a-z0-9-]+):before/g)].map((m) => m[1]));
  const missing = [...literals].filter((name) => !cssIcons.has(name)).sort();
  assert.deepEqual(missing, [], `иконок нет в icons.css: ${missing.join(', ')}`);

  // Семейство иконки в CSS не записано, поэтому сверяем со входом сборщика:
  // он сам проверяет по cmap шрифта, что каждый запрошенный глиф там есть.
  const buildTool = fs.readFileSync(path.join(root, 'tools/build-fontawesome.py'), 'utf8');
  const iconsInStyle = (style) => {
    const names = new Set();

    for (const dictName of ['USED_IN_APP', 'EXTRAS']) {
      const dictStart = buildTool.indexOf(`${dictName} = {`);
      assert.notEqual(dictStart, -1, `${dictName} не найден в tools/build-fontawesome.py`);
      const dictEnd = buildTool.indexOf('\n}', dictStart);
      const styleList = buildTool
        .slice(dictStart, dictEnd)
        .match(new RegExp(`["']${style}["']\\s*:\\s*\\[([\\s\\S]*?)\\]`));
      assert.ok(styleList, `стиль ${style} не найден в ${dictName}`);
      [...styleList[1].matchAll(/["']([a-z0-9-]+)["']/g)].forEach((m) => names.add(m[1]));
    }

    return names;
  };

  const subset = {
    solid: iconsInStyle('solid'),
    regular: iconsInStyle('regular'),
    brands: iconsInStyle('brands'),
  };
  const wrongStyle = [...pairs]
    .filter((pair) => {
      const [style, name] = pair.split(' ');
      return !subset[style].has(name);
    })
    .map((pair) => {
      const [style, name] = pair.split(' ');
      return `fa-${style} fa-${name}`;
    })
    .sort();
  assert.deepEqual(
    wrongStyle,
    [],
    `иконка не входит в выбранное семейство: ${wrongStyle.join(', ')}`
  );

  // icons.json читает админка для datalist, поэтому он не должен разойтись со сборщиком.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'public/vendor/fontawesome/icons.json'), 'utf8')
  );
  for (const style of ['solid', 'regular', 'brands']) {
    assert.deepEqual(
      [...manifest[style]].sort(),
      [...subset[style]].sort(),
      `icons.json разошёлся со списком ${style} в tools/build-fontawesome.py`
    );
  }

  // Иконка услуги рендерится как class="fa fa-x", а .fa — solid-семейство.
  const seedSource = fs.readFileSync(path.join(root, 'seeds/seed.js'), 'utf8');
  const seedIcons = [...seedSource.matchAll(/icon:\s*['"](fa-[a-z0-9-]+)['"]/g)].map((m) =>
    m[1].slice(3)
  );
  const wrongSeedIcons = seedIcons.filter((name) => !subset.solid.has(name)).sort();
  assert.deepEqual(
    wrongSeedIcons,
    [],
    `иконка услуги из seeds нет в solid-сабсете: ${wrongSeedIcons.join(', ')}`
  );
});

test('Manrope is self-hosted and Google Fonts is no longer referenced', async () => {
  const vendor = path.join(__dirname, '..', 'public', 'vendor', 'manrope');
  assert.ok(fs.existsSync(path.join(vendor, 'manrope.css')), 'manrope.css must be committed');
  assert.ok(fs.existsSync(path.join(vendor, 'OFL.txt')), 'OFL license must live beside the font');

  const fonts = [
    'manrope-cyrillic-ext.woff2',
    'manrope-cyrillic.woff2',
    'manrope-latin-ext.woff2',
    'manrope-latin.woff2',
  ];
  for (const font of fonts) {
    const file = path.join(vendor, font);
    assert.ok(fs.existsSync(file), `${font} must be committed`);
    assert.ok(fs.statSync(file).size > 1000, `${font} looks truncated`);
    const res = await request(app).get(`/vendor/manrope/${font}`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /font\/woff2/);
  }

  for (const page of ['/', '/contacts', '/admin/login']) {
    const res = await request(app).get(page);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(`href="${asset('/vendor/manrope/manrope.css')}"`));
    assert.doesNotMatch(res.text, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  }

  const css = await request(app).get(asset('/vendor/manrope/manrope.css'));
  assert.equal(css.status, 200);
  assert.match(css.text, /font-family: 'Manrope'/);
  assert.match(css.text, /font-weight: 400 800/);
  assert.ok(
    css.text.includes(`url("${asset('/vendor/manrope/manrope-cyrillic.woff2')}")`),
    'font urls inside hashed css must point at hashed files'
  );

  const legacyCss = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'style.css'),
    'utf8'
  );
  assert.doesNotMatch(legacyCss, /fonts\.googleapis\.com/, 'no Google Fonts import may remain');

  const csp = (await request(app).get('/')).headers['content-security-policy'] || '';
  assert.doesNotMatch(csp, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(csp, /font-src 'self'/);
});

test('static assets use hashed names and a one-year immutable cache', async () => {
  const manifestFile = path.join(__dirname, '..', 'public', 'assets', 'manifest.json');
  assert.ok(fs.existsSync(manifestFile), 'npm test must build the asset manifest');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.ok(Object.keys(manifest).length >= 10, 'all css/js/vendor assets must be hashed');

  const sources = [
    '/css/site.css',
    '/js/main.js',
    '/vendor/manrope/manrope.css',
    '/vendor/fontawesome/icons.css',
    '/favicon.svg',
  ];
  for (const source of sources) {
    const hashedUrl = manifest[source];
    assert.match(
      hashedUrl,
      /^\/assets\/.+\.[0-9a-f]{8}\.(css|js|svg|woff2)$/,
      `${source} must map to a hashed copy`
    );

    const res = await request(app).get(hashedUrl);
    assert.equal(res.status, 200, `${hashedUrl} must be served`);
    assert.match(res.headers['cache-control'], /public/);
    assert.match(res.headers['cache-control'], /max-age=31536000/);
    assert.match(res.headers['cache-control'], /immutable/);

    const served = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text || '');
    assert.deepEqual(
      served,
      fs.readFileSync(path.join(__dirname, '..', 'public', hashedUrl.slice(1))),
      `${hashedUrl} must serve the built copy`
    );
  }

  for (const page of ['/', '/admin/login']) {
    const res = await request(app).get(page);
    assert.equal(res.status, 200);
    const assetUrls = [...res.text.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js|svg|woff2))"/g)].map(
      (match) => match[1]
    );
    assert.ok(assetUrls.length >= 6, `${page} must reference hashed assets`);
    for (const url of assetUrls) {
      // Картинки работ и загрузки живут в БД/каталоге uploads — это контент, а не сборка.
      if (url.startsWith('/gallery-placeholders/') || url.startsWith('/uploads/')) {
        continue;
      }
      assert.match(
        url,
        /^\/assets\/.+\.[0-9a-f]{8}\.(css|js|svg|woff2)$/,
        `${page} references ${url} without a hash`
      );
    }
  }

  const nginx = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'nginx.conf.example'), 'utf8');
  assert.match(nginx, /location \^~ \/assets\//);
  assert.match(nginx, /expires 1y;/);
  assert.match(nginx, /immutable/);
});

test('GET /healthz reports database availability', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.db, 'ok');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('migrations create order indexes and stay idempotent', async () => {
  const [journal] = await sequelize.query('PRAGMA journal_mode;');
  assert.equal(journal[0].journal_mode, 'wal', 'WAL mode must be enabled for the file database');

  const [busy] = await sequelize.query('PRAGMA busy_timeout;');
  assert.equal(busy[0].timeout, 5000, 'busy_timeout must be set on the pooled connection');

  await sequelize.transaction(async (transaction) => {
    const [rows] = await sequelize.query('PRAGMA busy_timeout;', { transaction });
    assert.equal(rows[0].timeout, 5000, 'transaction connections need busy_timeout too');
  });

  const [rows] = await sequelize.query(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Orders'"
  );
  const names = rows.map((row) => row.name);
  assert.ok(
    names.includes('orders_status_created_at_idx'),
    'composite index serves filter by status plus sorting by date'
  );
  assert.ok(
    names.includes('orders_created_at_idx'),
    'createdAt index serves sorting without filters'
  );
  assert.ok(
    names.includes('orders_telegram_chat_created_at_idx'),
    'composite chat id index serves «Мои заявки» with sorting'
  );
  // Одиночные индексы по status и chat id покрыты префиксами составных.
  assert.ok(!names.includes('orders_status_idx'), 'redundant status-only index must be dropped');
  assert.ok(
    !names.includes('orders_telegram_chat_id_idx'),
    'redundant chat-only index must be dropped'
  );

  // Смысл составного индекса — в отказе от временной сортировки, поэтому проверяем план запроса.
  const [plan] = await sequelize.query(
    "EXPLAIN QUERY PLAN SELECT * FROM Orders WHERE status = 'new' ORDER BY createdAt DESC LIMIT 5"
  );
  const details = plan.map((row) => row.detail).join(' | ');
  assert.match(details, /orders_status_created_at_idx/, `planner ignored the index: ${details}`);
  assert.doesNotMatch(details, /TEMP B-TREE/, `sorting still builds a temp B-tree: ${details}`);

  const [myOrdersPlan] = await sequelize.query(
    "EXPLAIN QUERY PLAN SELECT * FROM Orders WHERE telegramChatId = '42' ORDER BY createdAt DESC LIMIT 10"
  );
  const myOrdersDetails = myOrdersPlan.map((row) => row.detail).join(' | ');
  assert.match(
    myOrdersDetails,
    /orders_telegram_chat_created_at_idx/,
    `planner ignored the chat index: ${myOrdersDetails}`
  );
  assert.doesNotMatch(
    myOrdersDetails,
    /TEMP B-TREE/,
    `«Мои заявки» still builds a temp B-tree: ${myOrdersDetails}`
  );

  const appliedAgain = await runMigrations({
    sequelize,
    queryInterface: sequelize.getQueryInterface(),
    logger: { log() {} },
  });
  assert.deepEqual(appliedAgain, [], 'second run must apply nothing');
});

test('gallery renders first page on server and paginates through the API', async () => {
  // Больше MAX_API_LIMIT работ, чтобы проверка потолка limit была различимой.
  const TOTAL = 60;
  const created = await GalleryItem.bulkCreate(
    Array.from({ length: TOTAL }, (_, i) => ({
      title: `Пагинация ${String(i + 1).padStart(2, '0')}`,
      type: 'image',
      url: '/gallery-placeholders/sample-2.svg',
      category: i < 5 ? 'scan' : 'photo',
      description: '',
      order: 100 + i,
    }))
  );
  const cleanup = async () => {
    await GalleryItem.destroy({ where: { id: created.map((item) => item.id) } });
  };

  try {
    // В базе есть работы из других тестов, поэтому ожидаемую страницу считаем по API,
    // а не хардкодом: проверяем, что SSR отдаёт ровно те же карточки, что и лимит=размер страницы.
    const ordered = [];
    for (let offset = 0; ; offset += 48) {
      const batch = await request(app).get(`/api/gallery?limit=48&offset=${offset}`);
      ordered.push(...batch.body.items);
      if (batch.body.items.length < 48) break;
    }
    assert.equal(ordered.length, TOTAL + 1);
    assert.equal(
      ordered[0].title,
      'Тестовая работа',
      'other tests leave their works in the gallery'
    );
    const expectedFirstPage = ordered.slice(0, 12).map((item) => item.title);
    const beyondFirstPage = ordered.slice(12).map((item) => item.title);

    const page = await request(app).get('/gallery');
    assert.equal(page.status, 200);
    assert.match(page.text, /data-gallery-grid/, 'grid must expose the load-more hook');
    assert.equal(
      (page.text.match(/data-gallery-item/g) || []).length,
      12,
      'SSR must render exactly one page of items'
    );
    assert.match(
      page.text,
      new RegExp(`data-gallery-total="${TOTAL + 1}"`),
      'total counts all unfiltered works'
    );
    assert.match(
      page.text,
      /data-gallery-page-size="12"/,
      'SSR page size is exposed to the client'
    );
    assert.ok(
      expectedFirstPage.every((title) => page.text.includes(title)),
      `first HTML page must carry the first 12 works: ${expectedFirstPage.join(', ')}`
    );
    assert.ok(
      beyondFirstPage.every((title) => !page.text.includes(title)),
      'works beyond the first page must not be in the HTML'
    );
    assert.ok(expectedFirstPage.some((title) => title.startsWith('Пагинация')));

    // Без JS галерея листается GET-ссылками: страница, категория и q живут в query.
    const moreHref = page.text.match(/data-gallery-more href="([^"]+)"/);
    assert.ok(moreHref, 'first page must offer a no-JS link to the next page');
    assert.equal(moreHref[1].replace(/&amp;/g, '&'), '/gallery?page=2');

    const secondPage = await request(app).get('/gallery?page=2');
    assert.equal(secondPage.status, 200);
    assert.equal(
      (secondPage.text.match(/data-gallery-item/g) || []).length,
      12,
      'second server page carries the next 12 works'
    );
    assert.match(secondPage.text, /data-gallery-page="2"/);
    const secondPageTitles = ordered.slice(12, 24).map((item) => item.title);
    assert.ok(
      secondPageTitles.every((title) => secondPage.text.includes(title)),
      'second HTML page must carry works 13..24'
    );
    assert.ok(
      ordered.slice(24).every((title) => !secondPage.text.includes(title)),
      'works beyond the second page must not be in the HTML'
    );
    assert.equal(
      secondPage.text.match(/data-gallery-more href="([^"]+)"/)?.[1],
      '/gallery?page=3',
      'more link advances the server page'
    );

    const scanPage = await request(app).get('/gallery?category=scan');
    assert.equal(scanPage.status, 200);
    assert.match(scanPage.text, /data-gallery-filter="scan"/);
    assert.equal(
      (scanPage.text.match(/data-gallery-item/g) || []).length,
      5,
      'category filter applies on the server'
    );
    assert.match(
      scanPage.text,
      /class="filter-chip active" href="\/gallery\?category=scan"/,
      'active chip is rendered as a plain link'
    );

    const scanWithQuery = await request(app).get('/gallery?category=scan&q=пагинация');
    const scanMore = scanWithQuery.text.match(/data-gallery-more href="([^"]+)"/);
    if (scanMore) {
      const href = new URL(scanMore[1].replace(/&amp;/g, '&'), 'http://localhost');
      assert.equal(href.searchParams.get('category'), 'scan', 'fallback link keeps the category');
      assert.equal(href.searchParams.get('q'), 'пагинация', 'fallback link keeps the query');
      assert.equal(href.searchParams.get('page'), '2');
    }

    const pageCount = Math.ceil(ordered.length / 12);
    const tooFar = await request(app).get('/gallery?page=999');
    assert.equal(tooFar.status, 200, 'out-of-range page is clamped, not a 404');
    assert.match(tooFar.text, new RegExp(`data-gallery-page="${pageCount}"`));
    assert.ok(
      tooFar.text.includes(ordered[ordered.length - 1].title),
      'clamped page shows the last work'
    );
    assert.doesNotMatch(tooFar.text, /data-gallery-more/, 'last page has no more link');

    const zeroPage = await request(app).get('/gallery?page=0');
    assert.match(zeroPage.text, /data-gallery-page="1"/, 'page below 1 falls back to the first');

    const first = await request(app).get('/api/gallery?limit=5&offset=10');
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 5);
    assert.equal(first.body.total, TOTAL + 1);
    assert.deepEqual(
      first.body.items.map((item) => item.title),
      ordered.slice(10, 15).map((item) => item.title),
      'offset/limit slice the same ordering the SSR page uses'
    );
    assert.deepEqual(
      Object.keys(first.body.items[0]).sort(),
      ['category', 'description', 'height', 'thumbnail', 'title', 'type', 'url', 'width'],
      'API exposes only the card fields, not internal id/order/timestamps'
    );

    const capped = await request(app).get('/api/gallery?limit=500');
    assert.equal(capped.body.items.length, 48, 'limit must be capped at 48');

    const scanned = await request(app).get('/api/gallery?category=scan&limit=48');
    assert.equal(scanned.body.items.length, 5, 'category filter keeps only its own works');
    assert.equal(scanned.body.total, 5);
    assert.ok(
      scanned.body.items.every((item) => item.category === 'scan'),
      'every returned item belongs to the category'
    );

    const searched = await request(app).get('/api/gallery?q=пагинация&limit=48');
    assert.equal(searched.body.total, TOTAL, 'Cyrillic q must match regardless of case');

    const searchedPage = await request(app).get('/api/gallery?q=ПАГИНАЦИЯ&limit=5&offset=25');
    assert.equal(searchedPage.body.items.length, 5, 'offset applies to the filtered subset');
    assert.equal(searchedPage.body.items[0].title, 'Пагинация 26');

    const htmlSearch = await request(app).get('/gallery?q=пагинация');
    assert.equal(htmlSearch.status, 200);
    assert.match(
      htmlSearch.text,
      new RegExp(`data-gallery-total="${TOTAL}"`),
      'SSR total follows the search filter'
    );
    assert.match(
      htmlSearch.text,
      /data-gallery-q="пагинация"/,
      'query is passed to the client for load-more'
    );

    const emptyCategory = await request(app).get('/api/gallery?category=__none__');
    assert.deepEqual(emptyCategory.body, { items: [], total: 0 });
  } finally {
    await cleanup();
  }
});

test('uploaded images are resized to webp and broken files are rejected', async () => {
  const jar = await loginJar();
  const uploadsRoot = path.join(__dirname, '..', 'public');
  const createdFiles = [];
  const bigTitle = `Большое фото ${Date.now()}`;
  const posterTitle = `Работа с постером ${Date.now()}`;
  const brokenTitle = `Битое фото ${Date.now()}`;

  const bigJpeg = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: { r: 200, g: 80, b: 60 } },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  const posterPng = await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: { r: 40, g: 90, b: 200 } },
  })
    .png()
    .toBuffer();

  try {
    const serviceRes = await request(app)
      .post('/admin/services')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', bigTitle)
      .field('price', '10')
      .field('isActive', 'on')
      .attach('image', bigJpeg, { filename: 'big.jpg', contentType: 'image/jpeg' });

    assert.equal(serviceRes.status, 302);
    const service = await Service.findOne({ where: { title: bigTitle } });
    assert.ok(service, 'service with big photo must be created');
    assert.match(service.image, /\.webp$/);
    const servicePath = path.join(uploadsRoot, service.image.replace(/^\//, ''));
    createdFiles.push(servicePath);

    // Читаем файл в буфер: sharp может ещё держать дескриптор, а Windows не даёт удалить файл.
    const readMeta = (filePath) => sharp(fs.readFileSync(filePath)).metadata();
    const serviceMeta = await readMeta(servicePath);
    assert.equal(serviceMeta.format, 'webp');
    assert.ok(
      serviceMeta.width <= 1920 && serviceMeta.height <= 1920,
      `размер ${serviceMeta.width}×${serviceMeta.height}`
    );
    const serviceSize = fs.statSync(servicePath).size;
    assert.ok(serviceSize < 500 * 1024, `webp весит ${Math.round(serviceSize / 1024)} КБ`);
    assert.equal(service.width, serviceMeta.width, 'DB must keep processed image width');
    assert.equal(service.height, serviceMeta.height, 'DB must keep processed image height');

    const servicesHtml = await request(app).get('/services');
    assert.match(
      servicesHtml.text,
      new RegExp(`width="${serviceMeta.width}" height="${serviceMeta.height}"`),
      'service card must reserve the image box'
    );

    const galleryRes = await request(app)
      .post('/admin/gallery')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', posterTitle)
      .field('category', 'photo')
      .attach('media', bigJpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .attach('poster', posterPng, { filename: 'poster.png', contentType: 'image/png' });

    assert.equal(galleryRes.status, 302);
    const item = await GalleryItem.findOne({ where: { title: posterTitle } });
    assert.ok(item, 'gallery item with big media and poster must be created');
    assert.equal(item.type, 'image');
    const mediaMeta = await readMeta(path.join(uploadsRoot, item.url.replace(/^\//, '')));
    assert.equal(item.width, mediaMeta.width, 'gallery item must keep processed media width');
    assert.equal(item.height, mediaMeta.height, 'gallery item must keep processed media height');
    const mediaPath = path.join(uploadsRoot, item.url.replace(/^\//, ''));
    const posterPath = path.join(uploadsRoot, item.thumbnail.replace(/^\//, ''));
    createdFiles.push(mediaPath, posterPath);

    const posterMeta = await readMeta(posterPath);
    assert.ok(
      posterMeta.width <= 1280 && posterMeta.height <= 1280,
      `постер ${posterMeta.width}×${posterMeta.height}`
    );

    const broken = await request(app)
      .post('/admin/services')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', brokenTitle)
      .field('price', '10')
      .attach('image', Buffer.from('это точно не изображение'), {
        filename: 'broken.png',
        contentType: 'image/png',
      });

    assert.equal(broken.status, 302);
    assert.match(broken.headers.location, /\/admin\/services\/new/);
    assert.equal(
      await Service.findOne({ where: { title: brokenTitle } }),
      null,
      'broken upload must not create a row'
    );
  } finally {
    createdFiles.forEach((file) =>
      fs.rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 })
    );
    await Service.destroy({ where: { title: [bigTitle, brokenTitle] } });
    await GalleryItem.destroy({ where: { title: posterTitle } });
  }
});

test('uploads accept .jpeg extension for services and gallery', async () => {
  const jar = await loginJar();
  const serviceTitle = `JPEG услуга ${Date.now()}`;
  const galleryTitle = `JPEG галерея ${Date.now()}`;
  const createdFiles = [];

  const jpeg = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 140, b: 60 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  try {
    const serviceRes = await request(app)
      .post('/admin/services')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', serviceTitle)
      .field('price', '10')
      .field('isActive', 'on')
      .attach('image', jpeg, { filename: 'photo.jpeg', contentType: 'image/jpeg' });

    assert.equal(
      serviceRes.headers.location,
      '/admin/services',
      '.jpeg must not be rejected as an unknown type'
    );
    const service = await Service.findOne({ where: { title: serviceTitle } });
    assert.ok(service, 'service with .jpeg image must be created');
    assert.match(service.image, /\.webp$/);
    createdFiles.push(path.join(__dirname, '..', 'public', service.image.replace(/^\//, '')));

    const galleryRes = await request(app)
      .post('/admin/gallery')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .field('_csrf', csrfToken)
      .field('title', galleryTitle)
      .field('category', 'photo')
      .attach('media', jpeg, { filename: 'shot.jpeg', contentType: 'image/jpeg' });

    assert.equal(galleryRes.headers.location, '/admin/gallery', '.jpeg media must be accepted');
    const item = await GalleryItem.findOne({ where: { title: galleryTitle } });
    assert.ok(item, 'gallery item with .jpeg media must be created');
    createdFiles.push(path.join(__dirname, '..', 'public', item.url.replace(/^\//, '')));

    createdFiles.forEach((file) => assert.ok(fs.existsSync(file), `файл не найден: ${file}`));
  } finally {
    // Буфер уже прочитан в память, поэтому sharp не держит дескриптор и файлы удаляются.
    createdFiles.forEach((file) =>
      fs.rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 })
    );
    await Service.destroy({ where: { title: serviceTitle } });
    await GalleryItem.destroy({ where: { title: galleryTitle } });
  }
});

test('map embed accepts one https iframe and rejects injected markup', async () => {
  const jar = await loginJar();
  const valid =
    '<iframe src="https://www.google.com/maps?q=test&output=embed" width="100%" height="100%" loading="lazy"></iframe>';
  const existing = await Setting.findOne({ where: { key: 'mapEmbed' } });
  const originalValue = existing ? existing.value : null;

  try {
    const accepted = await request(app)
      .post('/admin/settings')
      .set('Cookie', cookieHeader(jar))
      .set('Accept', 'text/html')
      .type('form')
      .send({ _csrf: csrfToken, mapEmbed: valid });

    assert.equal(accepted.status, 302);
    assert.equal((await Setting.findOne({ where: { key: 'mapEmbed' } })).value, valid);

    const payloads = [
      `${valid}<script>alert(1)</script>`,
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe src="https://example.com/map" onload="alert(1)"></iframe>',
      '<iframe src="http://example.com/map"></iframe>',
    ];

    for (const payload of payloads) {
      await request(app)
        .post('/admin/settings')
        .set('Cookie', cookieHeader(jar))
        .set('Accept', 'text/html')
        .type('form')
        .send({ _csrf: csrfToken, mapEmbed: payload });

      const stored = await Setting.findOne({ where: { key: 'mapEmbed' } });
      assert.equal(stored.value, valid, `должен быть отклонён: ${payload}`);
    }
  } finally {
    if (existing) {
      await existing.update({ value: originalValue });
    } else {
      await Setting.destroy({ where: { key: 'mapEmbed' } });
    }
  }
});

test('admin pages are rate limited', async () => {
  const jar = await loginJar();
  const res = await request(app).get('/admin').set('Cookie', cookieHeader(jar));

  assert.equal(res.status, 200);
  const limit = res.headers['ratelimit-limit'] || res.headers['ratelimit'];
  assert.ok(limit, 'GET /admin must send rate limit headers');
});

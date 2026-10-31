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

const { app, startApp } = require('../app');
const { sequelize, User, Service, GalleryItem, Order } = require('../models');
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

test('admin uploads files, rejects wrong types and oversized posters', async () => {
  const jar = await loginJar();
  const uploadsRoot = path.join(__dirname, '..', 'public');
  const diskPath = (url) => path.join(uploadsRoot, url.replace(/^\//, ''));
  const createdFiles = [];
  const serviceTitle = `Услуга с картинкой ${Date.now()}`;
  const badServiceTitle = `Услуга с svg ${Date.now()}`;
  const galleryTitle = `Работа с постером ${Date.now()}`;
  const bigTitle = `Постер слишком большой ${Date.now()}`;
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
    assert.match(service.image, /^\/uploads\/services\/[\w.-]+\.png$/);
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
    assert.match(item.thumbnail, /^\/uploads\/gallery\/[\w.-]+\.png$/);
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
  } finally {
    await Service.destroy({ where: { title: [serviceTitle, badServiceTitle] } });
    await GalleryItem.destroy({
      where: { title: [galleryTitle, bigTitle, badTitle] },
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
    assert.match(res.text, /href="\/vendor\/fontawesome\/icons\.css"/);
    assert.doesNotMatch(res.text, /cdnjs\.cloudflare\.com/);
    assert.match(res.text, /class="fa-solid fa-print"/);
  }

  const csp = (await request(app).get('/')).headers['content-security-policy'] || '';
  assert.doesNotMatch(csp, /cdnjs\.cloudflare\.com/);
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
    assert.match(res.text, /href="\/vendor\/manrope\/manrope\.css"/);
    assert.doesNotMatch(res.text, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  }

  const css = await request(app).get('/vendor/manrope/manrope.css');
  assert.equal(css.status, 200);
  assert.match(css.text, /font-family: 'Manrope'/);
  assert.match(css.text, /font-weight: 400 800/);

  const legacyCss = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'style.css'),
    'utf8'
  );
  assert.doesNotMatch(legacyCss, /fonts\.googleapis\.com/, 'no Google Fonts import may remain');

  const csp = (await request(app).get('/')).headers['content-security-policy'] || '';
  assert.doesNotMatch(csp, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(csp, /font-src 'self'/);
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

    const first = await request(app).get('/api/gallery?limit=5&offset=10');
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 5);
    assert.equal(first.body.total, TOTAL + 1);
    assert.deepEqual(
      first.body.items.map((item) => item.title),
      ordered.slice(10, 15).map((item) => item.title),
      'offset/limit slice the same ordering the SSR page uses'
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

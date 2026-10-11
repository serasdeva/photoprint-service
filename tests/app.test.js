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
fs.rmSync(dbFile, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { app, startApp } = require('../app');
const { sequelize, User, Service, GalleryItem, Order } = require('../models');

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

async function loginJar() {
  const jar = { csrf_token: csrfToken };
  const login = await request(app)
    .post('/admin/login')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .type('form')
    .send({ username: 'admin-test', password: 'Test1234!', _csrf: csrfToken });
  collectCookies(login, jar);
  assert.ok(jar.auth_token, 'auth cookie must be issued');
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
  fs.rmSync(dbFile, { force: true });
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

test('GET /contacts renders the responsive order form', async () => {
  const res = await request(app).get('/contacts');
  assert.equal(res.status, 200);
  assert.match(res.text, /href="tel:\+74951234567"/);
  assert.match(res.text, /data-form="order"/);
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

<<<<<<< HEAD
  const loginPage = await request(app).get('/admin/login').set('Cookie', cookieHeader(jar));
=======
  const sessionJar = collectCookies(res);
  const loginPage = await request(app)
    .get('/admin/login')
    .set('Cookie', cookieHeader(sessionJar));
>>>>>>> fefa6cec8261bc115d104904de7dfd1411534619
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

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `photoprint-telegram-test-${process.pid}.sqlite`);
process.env.DB_STORAGE = dbFile;
process.env.SESSION_DIR = path.join(os.tmpdir(), `photoprint-telegram-sessions-${process.pid}`);
fs.rmSync(dbFile, { force: true });

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { Telegraf } = require('telegraf');

const { app, startApp } = require('../app');
const { sequelize, Service, Order, Setting } = require('../models');
const helpers = require('../telegram/helpers');
const notifications = require('../telegram/notifications');
const orderHandler = require('../telegram/handlers/order');
const adminHandler = require('../telegram/handlers/admin');
const { registerHandlers } = require('../telegram/handlers');

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

function fakeBot() {
  const calls = [];
  return {
    calls,
    telegram: {
      async sendMessage(chatId, text, extra) {
        calls.push({ chatId, text, extra });
        return { message_id: calls.length };
      },
    },
  };
}

async function createOrder(overrides = {}) {
  return Order.create({
    name: 'Тест',
    phone: '+7 999 000-00-00',
    email: '',
    service: 'Тестовая услуга',
    message: '',
    status: 'new',
    source: 'site',
    ...overrides,
  });
}

before(async () => {
  await startApp();

  await Service.create({
    title: 'Тестовая услуга бота',
    slug: `bot-service-${Date.now()}`,
    description: 'Описание',
    price: 50,
    priceUnit: 'шт',
    icon: 'fa-print',
    order: 1,
    isActive: true,
  });

  const home = await request(app).get('/');
  assert.equal(home.status, 200);
  csrfToken = collectCookies(home).csrf_token;
  assert.ok(csrfToken);
});

after(async () => {
  await sequelize.close();
  [dbFile, `${dbFile}-wal`, `${dbFile}-shm`].forEach((file) => fs.rmSync(file, { force: true }));
  fs.rmSync(process.env.SESSION_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  notifications.setBot(null);
});

test('helpers validate and format values safely', () => {
  assert.equal(helpers.escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
  assert.equal(helpers.validateName('И'), false);
  assert.equal(helpers.validateName('Иван'), true);
  assert.equal(helpers.validatePhone('123'), false);
  assert.equal(helpers.validatePhone('+7 (999) 000-00-00'), true);
  assert.equal(helpers.normalizePhone('+7 (999) 000-00-00'), '+79990000000');
  assert.equal(helpers.statusLabel('done'), 'Готова');
  assert.equal(helpers.formatPrice(0, 'шт'), 'по запросу');
  assert.match(helpers.formatPrice(25, 'шт'), /25/);
});

test('admin order keyboard exposes status callbacks and panel link', () => {
  const keyboard = helpers.adminOrderKeyboard({ id: 42, status: 'new' });
  const data = (keyboard.inline_keyboard || [])
    .flat()
    .map((button) => button.callback_data || button.url);
  assert.ok(data.includes('order:status:42:in_progress'));
  assert.ok(data.includes('order:status:42:done'));
  assert.ok(data.some((value) => value && value.includes('/admin/orders?q=42')));
});

test('order wizard validates name and phone steps', async () => {
  const session = { order: { step: 'name', data: {} } };
  const replies = [];
  const ctx = {
    session,
    message: { text: '' },
    reply: async (text) => replies.push(text),
  };

  ctx.message.text = 'A';
  assert.equal(await orderHandler.processTextStep(ctx), true);
  assert.equal(session.order.step, 'name');

  ctx.message.text = 'Иван';
  assert.equal(await orderHandler.processTextStep(ctx), true);
  assert.equal(session.order.data.name, 'Иван');
  assert.equal(session.order.step, 'phone');

  ctx.message.text = '123';
  await orderHandler.processTextStep(ctx);
  assert.equal(session.order.step, 'phone');

  ctx.message.text = '+7 (999) 111-22-33';
  await orderHandler.processTextStep(ctx);
  assert.equal(session.order.data.phone, '+79991112233');
  assert.equal(session.order.step, 'service');
});

test('finalizeOrder stores a telegram order in the database', async () => {
  const order = await orderHandler.finalizeOrder({
    chatId: 987654,
    userId: 123,
    name: 'Клиент бота',
    phone: '+79990001122',
    serviceTitle: 'Тестовая услуга бота',
    message: 'Хочу фото',
  });

  try {
    assert.equal(order.source, 'telegram');
    assert.equal(order.telegramChatId, '987654');
    assert.equal(order.telegramUserId, '123');
    assert.equal(order.phone, '+79990001122');
  } finally {
    await order.destroy();
  }
});

test('notifyAdminNewOrder sends a formatted message through the bot', async () => {
  await Setting.create({ key: 'telegramAdminChatId', value: '555000' });
  await Setting.create({ key: 'telegramNotifyOrders', value: 'true' });

  const bot = fakeBot();
  notifications.setBot(bot);

  const result = await notifications.notifyAdminNewOrder({
    id: 7,
    name: 'Иван & Ко',
    phone: '+79990001122',
    email: '',
    service: 'Фото',
    message: '',
    status: 'new',
    source: 'site',
  });

  assert.equal(result.delivered, true);
  assert.equal(bot.calls.length, 1);
  assert.equal(bot.calls[0].chatId, '555000');
  assert.match(bot.calls[0].text, /Иван &amp; Ко/);
  assert.match(bot.calls[0].text, /#7/);

  await Setting.destroy({ where: { key: ['telegramAdminChatId', 'telegramNotifyOrders'] } });
});

test('notifyAdminNewOrder is skipped when notifications are disabled', async () => {
  await Setting.create({ key: 'telegramAdminChatId', value: '555000' });
  await Setting.create({ key: 'telegramNotifyOrders', value: 'false' });

  const bot = fakeBot();
  notifications.setBot(bot);

  const result = await notifications.notifyAdminNewOrder({
    id: 8,
    name: 'A',
    phone: '+79990001122',
  });
  assert.equal(result.skipped, true);
  assert.equal(bot.calls.length, 0);

  await Setting.destroy({ where: { key: ['telegramAdminChatId', 'telegramNotifyOrders'] } });
});

test('changeOrderStatus updates status and notifies the telegram client', async () => {
  const order = await createOrder({ source: 'telegram', telegramChatId: '777888' });
  const bot = fakeBot();
  notifications.setBot(bot);

  try {
    const updated = await adminHandler.changeOrderStatus(order.id, 'done');
    assert.equal(updated.status, 'done');
    assert.equal(bot.calls.length, 1);
    assert.equal(bot.calls[0].chatId, '777888');
    assert.match(bot.calls[0].text, /Готова/);
  } finally {
    await order.destroy();
  }
});

test('setNotifyEnabled persists the toggle in settings', async () => {
  await adminHandler.setNotifyEnabled(false);
  assert.equal((await helpers.getTelegramSettings()).notifyOrders, false);

  await adminHandler.setNotifyEnabled(true);
  assert.equal((await helpers.getTelegramSettings()).notifyOrders, true);
});

test('POST /api/orders keeps source=site for web submissions', async () => {
  const unique = `web-client-${Date.now()}`;
  const res = await request(app)
    .post('/api/orders')
    .set('Cookie', `csrf_token=${csrfToken}`)
    .set('x-csrf-token', csrfToken)
    .send({ name: unique, phone: '+7 900 000-11-22' });

  assert.equal(res.status, 201);

  const order = await Order.findOne({ where: { name: unique } });
  try {
    assert.ok(order);
    assert.equal(order.source, 'site');
    assert.equal(order.telegramChatId, null);
  } finally {
    if (order) await order.destroy();
  }
});

test('bot dispatches /whoami and /start updates end-to-end without network', async () => {
  const bot = new Telegraf('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
  const calls = [];
  const telegramProto = Object.getPrototypeOf(bot.telegram);
  const originalCallApi = telegramProto.callApi;

  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'PhotoPrint',
    username: 'photoprint_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  telegramProto.callApi = async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: calls.length };
  };
  registerHandlers(bot);

  function update(text, id) {
    return {
      update_id: id,
      message: {
        message_id: id,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 4242, type: 'private' },
        from: { id: 4242, is_bot: false, first_name: 'Тестер' },
        text,
        entities: text.startsWith('/')
          ? [{ type: 'bot_command', offset: 0, length: text.length }]
          : [],
      },
    };
  }

  try {
    await bot.handleUpdate(update('/whoami', 1));
    await bot.handleUpdate(update('/start', 2));
  } finally {
    telegramProto.callApi = originalCallApi;
  }

  const messages = calls
    .filter((call) => call.method === 'sendMessage')
    .map((call) => call.payload.text);
  assert.ok(
    messages.some((text) => text.includes('4242')),
    'whoami must echo the chat id'
  );
  assert.ok(
    messages.some((text) => text.includes('Главное меню')),
    'start must render the menu'
  );
});

test('GET /admin/settings/telegram requires authentication', async () => {
  const res = await request(app).get('/admin/settings/telegram');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/admin\/login/);
});

test('admin telegram settings page renders and saves configuration', async () => {
  await require('../models').User.create({
    username: 'bot-admin',
    email: 'bot-admin@example.com',
    passwordHash: await bcrypt.hash('Test1234!', 10),
    role: 'admin',
  });

  const jar = { csrf_token: csrfToken };
  const login = await request(app)
    .post('/admin/login')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .type('form')
    .send({ username: 'bot-admin', password: 'Test1234!', _csrf: csrfToken });
  collectCookies(login, jar);
  assert.ok(jar.auth_token);

  const page = await request(app).get('/admin/settings/telegram').set('Cookie', cookieHeader(jar));
  assert.equal(page.status, 200);
  assert.match(page.text, /Telegram-бот/);
  assert.match(page.text, /name="telegramAdminChatId"/);

  const saved = await request(app)
    .post('/admin/settings/telegram')
    .set('Cookie', cookieHeader(jar))
    .type('form')
    .send({
      _csrf: csrfToken,
      telegramAdminChatId: '112233',
      telegramNotifyOrders: 'true',
      telegramWelcome: 'Привет из теста',
    });
  assert.equal(saved.status, 302);
  assert.match(saved.headers.location, /\/admin\/settings\/telegram/);

  const chatIdSetting = await Setting.findOne({ where: { key: 'telegramAdminChatId' } });
  assert.equal(chatIdSetting.value, '112233');

  const testRes = await request(app)
    .post('/admin/settings/telegram/test')
    .set('Cookie', cookieHeader(jar))
    .set('Accept', 'text/html')
    .type('form')
    .send({ _csrf: csrfToken });
  assert.equal(testRes.status, 302);

  await Setting.destroy({ where: { key: 'telegramAdminChatId' } });
});

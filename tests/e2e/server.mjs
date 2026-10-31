import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Отдельный инстанс на прогон: своя временная БД и каталог сессий, чтобы E2E
// не трогали рабочую data/photoprint.sqlite и сессии разработчика.
const PORT = Number(process.env.E2E_PORT || 4173);
const dbFile = path.join(os.tmpdir(), 'photoprint-e2e.sqlite');
const sessionDir = path.join(os.tmpdir(), 'photoprint-e2e-sessions');

// Фиксированные имена: сервер один и живёт только на время прогона. Файлы прошлых
// запусков удаляем сразу — они могли остаться после принудительного завершения.
function removeIfPossible(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    // Windows иногда держит файл ещё миг после гибели процесса: подхватим в следующий раз.
    console.warn(`[e2e] не удалось удалить ${target}: ${error.message}`);
  }
}

for (const entry of fs.readdirSync(os.tmpdir())) {
  if (entry.startsWith('photoprint-e2e')) {
    removeIfPossible(path.join(os.tmpdir(), entry));
  }
}

[dbFile, `${dbFile}-wal`, `${dbFile}-shm`].forEach(removeIfPossible);
removeIfPossible(sessionDir);

// env читается при загрузке app.js и models, поэтому выставляем его до импортов.
process.env.NODE_ENV = 'test';
process.env.PORT = String(PORT);
process.env.DB_STORAGE = dbFile;
process.env.SESSION_DIR = sessionDir;
process.env.SESSION_SECRET = 'e2e-session-secret';
process.env.JWT_SECRET = 'e2e-jwt-secret';
process.env.BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.BOT_ENABLED = 'false';

const { buildAssets } = await import('../../tools/build-assets.js');
const { startApp } = await import('../../app.js');
const { sequelize, User, Service, GalleryItem } = await import('../../models/index.js');
const bcrypt = (await import('bcryptjs')).default;

// Шаблоны берут адреса из манифеста: без сборки страница отдаёт исходные пути
// и Playwright не проверит реальную разметку с хешами.
buildAssets();
const app = await startApp();

const passwordHash = await bcrypt.hash('E2eAdmin123!', 10);
await User.create({
  username: 'e2e-admin',
  email: 'e2e@example.com',
  passwordHash,
  role: 'admin',
});

// 15 работ при pageSize 12 — ровно два экрана: проверяем и «Показать ещё», и счётчик.
const categories = ['photo', 'print', 'docs'];
for (let index = 1; index <= 15; index += 1) {
  await GalleryItem.create({
    title: `Работа ${index}`,
    type: 'image',
    url: `/gallery-placeholders/sample-${((index - 1) % 4) + 1}.svg`,
    category: categories[(index - 1) % categories.length],
    description: `Описание работы ${index}`,
    order: index,
  });
}

await Service.create({
  title: 'E2E услуга',
  slug: 'e2e-service',
  description: 'Услуга для сквозных тестов',
  price: 100,
  priceUnit: 'шт',
  icon: 'fa-print',
  order: 1,
  isActive: true,
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[e2e] сервер на http://127.0.0.1:${PORT}`);
});

async function shutdown(signal) {
  console.log(`[e2e] ${signal}, останавливаюсь`);
  server.close();
  await sequelize.close();
  [dbFile, `${dbFile}-wal`, `${dbFile}-shm`].forEach((file) => fs.rmSync(file, { force: true }));
  fs.rmSync(sessionDir, { recursive: true, force: true });
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

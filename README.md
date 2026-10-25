# PhotoPrint Service

Node.js + Express сервис фотопечати, копирования и оформления документов: публичный сайт + админ-панель.

## Возможности

### Сайт

- Страницы: главная, услуги (с детальными страницами по slug), галерея, контакты, политика конфиденциальности
- Форма заявки на сайте (`POST /api/orders`) с валидацией, honeypot-полем от спама и уведомлением на почту
- Фильтр галереи по категориям (список строится из данных), пагинация «Показать ещё», постер для видео
- Контакты, телефон и режим работы в шапке/футере берутся из настроек админки
- Тёмная/светлая тема, адаптивная вёрстка

### Админ-панель (`/admin`)

- Вход по логину/паролю (JWT в httpOnly-cookie), выход
- Rate limit на попытки входа (5 / 15 мин)
- Дашборд: статистика и последние заявки
- Услуги: CRUD, свой slug (уникальность с суффиксом), загрузка/замена/удаление изображения
- Галерея: CRUD, фото и видео (MP4), категории с подсказками (datalist), удаление файла
- Заявки: список, фильтр по статусу, поиск по имени/телефону/услуге, смена статуса, удаление
- Настройки сайта: название, контакты, hero-блок, HTML-код карты (белый список ключей)
- Настройки Telegram-бота: chat id администратора, приветствие, уведомления, тестовое сообщение

### Telegram-бот (опционально)

- Уведомления о новых заявках (с сайта и из бота) c быстрыми кнопками «В работу» / «Готово»
- Приём заявок клиентом через пошаговый диалог, «Мои заявки» со статусами
- Каталог услуг, галерея, контакты, FAQ, подписка на новости и рассылки
- Админ-команды: `/orders`, `/stats`, `/broadcast`, `/notify on|off`, `/whoami`

## Быстрый старт

```bash
npm install
copy .env.example .env   # Windows: задайте SESSION_SECRET и JWT_SECRET
npm run seed
npm start
```

Сервер: `http://localhost:3000`

### Переменные окружения (`.env`)

| Переменная          | Назначение                                                           |
| ------------------- | -------------------------------------------------------------------- |
| `PORT`              | Порт HTTP-сервера (по умолчанию 3000)                                |
| `NODE_ENV`          | `development` / `production`                                         |
| `SESSION_SECRET`    | Секрет сессий (обязательно в проде)                                  |
| `JWT_SECRET`        | Секрет JWT-токенов (обязательно в проде)                             |
| `SESSION_DIR`       | Каталог файловых сессий (по умолчанию `data/sessions`)               |
| `BASE_URL`          | Базовый URL для sitemap и canonical/OG-тегов                         |
| `CORS_ORIGINS`      | Список разрешённых origin через запятую (пусто = CORS выключен)      |
| `ADMIN_USERNAME`    | Логин администратора (при `npm run seed`)                            |
| `ADMIN_PASSWORD`    | Пароль администратора (обязателен для `npm run seed`)                |
| `MAIL_*`            | SMTP для уведомлений о заявках (если не заданы — почта пропускается) |
| `BOT_ENABLED`       | Включить Telegram-бота (`true`/`false`)                              |
| `BOT_TOKEN`         | Токен бота от @BotFather (без токена бот не запускается)             |
| `BOT_USERNAME`      | Имя бота без `@` — для ссылки `https://t.me/…` на сайте и в панели   |
| `BOT_ADMIN_CHAT_ID` | Chat id администратора (можно задать и в админке)                    |

## Telegram-бот

Бот работает в режиме long polling в том же процессе, что и сайт (запуск из `server.js`),
поэтому БД SQLite не открывается двумя процессами. Если `BOT_TOKEN` не задан или
`BOT_ENABLED=false`, бот просто не стартует, а сайт работает как обычно.

Настройка:

1. Создайте бота у [@BotFather](https://t.me/BotFather) и получите токен.
2. В `.env` укажите `BOT_ENABLED=true`, `BOT_TOKEN=…`, при желании `BOT_USERNAME=…`.
3. Перезапустите сервер (`npm start`).
4. Напишите боту `/whoami`, чтобы узнать свой chat id.
5. Откройте `/admin/settings/telegram`, укажите chat id, включите уведомления и отправьте тест.

> Важно: держите PM2 в режиме `instances: 1` (`deploy/ecosystem.config.js`). Несколько
> инстансов с long polling будут получать дубли апдейтов.

## Вход в админку

После `npm run seed` логин и пароль берутся из `.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`).
Если `ADMIN_PASSWORD` не задан, `npm run seed` завершится с ошибкой — придумайте надёжный пароль перед запуском.

Панель: `http://localhost:3000/admin/login`

> Смените пароль и секреты в `.env` перед публичным размещением.

## Скрипты npm

| Команда                | Описание                                                        |
| ---------------------- | --------------------------------------------------------------- |
| `npm start`            | Запуск сервера (`node server.js`)                               |
| `npm run dev`          | Запуск с nodemon                                                |
| `npm run seed`         | Идемпотентное наполнение БД (админ, настройки, услуги, галерея) |
| `npm run lint`         | Проверка кода ESLint                                            |
| `npm run lint:fix`     | Автоисправление ESLint                                          |
| `npm run format`       | Форматирование Prettier                                         |
| `npm run format:check` | Проверка форматирования                                         |
| `npm test`             | Тесты (node:test + supertest)                                   |

## Безопасность

- **CSP** через Helmet: скрипты только с `'self'`, запрещён `object-src`, `frame-ancestors 'self'`
- **CSRF**: double-submit токен в cookie + `_csrf` в формах и заголовок `x-csrf-token` в API
- **JWT**: httpOnly-cookie, отзыв при выходе (таблица `RevokedTokens`), роль читается из БД
- **Загрузки**: белый список расширений и MIME, лимиты размера, запрет отдачи `.html/.js/.svg` из `/uploads`
- **Rate limit**: вход (5/15 мин), заявки (20/15 мин), API (60/15 мин)
- Сессии в `data/sessions` (файловое хранилище), cookie `secure` в production

## Структура

```
app.js                 # Express: middleware, роуты, статика, обработчики ошибок
server.js              # Точка входа
config/db.js           # Sequelize + SQLite (data/photoprint.sqlite, DB_STORAGE для тестов)
controllers/           # Логика страниц и API
models/                # Service, GalleryItem, Order, Setting, User, RevokedToken, TelegramSubscriber
routes/                # public, admin, api
middleware/            # auth (JWT-cookie + отзыв), csrf (double-submit), upload (multer)
views/                 # EJS: публичные страницы + views/admin
public/                # css, js, uploads
telegram/              # Бот: config, bot, notifications, keyboards, handlers/*
seeds/seed.js          # Демо-данные
migrations/            # Изменения схемы существующей БД (индексы и т.п.)
tests/                 # Интеграционные тесты (node:test + supertest)
.github/workflows/     # CI: lint + format check + tests
utils/                 # asyncHandler, mailer, slugify, uploads
```

## Технологии

- Express 4, EJS, Sequelize + SQLite
- JWT + cookie auth, express-session, connect-flash
- Multer (загрузка файлов), Helmet, express-rate-limit, express-validator
- Nodemailer (опционально), bcryptjs
- Vanilla JS + собственный CSS (light/dark)

## Эксплуатация

- `GET /healthz` — проверка живости: `{ "status": "ok", "db": "ok", "uptime": N }`, при недоступной БД возвращает `503`. Подходит для systemd/uptime-мониторинга.
- `SIGTERM`/`SIGINT` обрабатываются в `server.js`: сервер перестаёт принимать соединения, бот останавливается, SQLite закрывается (жёсткий таймаут — 10 с).
- SQLite работает в режиме WAL с `busy_timeout = 5000`, поэтому сайт и бот могут писать одновременно.
- Миграции: `sequelize.sync()` создаёт недостающие таблицы, а изменения существующей схемы (индексы, новые колонки) лежат в `migrations/*.js` и применяются при старте. Учёт — в таблице `_schema_migrations`, повторный запуск ничего не делает.
- Сессии сайта и диалоги бота чистятся автоматически: просроченные файлы в `data/sessions` и `data/telegram-sessions` удаляются при старте и по таймеру.

## Заметки

- Загруженные файлы: `public/uploads/services`, `public/uploads/gallery` (постеры — там же)
- `data/` и `public/uploads/*` (кроме `.gitkeep`) в `.gitignore` — на новом клоне выполните `npm run seed`
- `sequelize.sync({ alter: true })` выполняется только при `NODE_ENV=development`; в проде таблицы создаются через `sync()`, а изменения схемы — только через `migrations/`
- Для видео загружайте постер в форме элемента галереи (авто-генерации превью нет)

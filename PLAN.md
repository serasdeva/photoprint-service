# План исправлений и улучшений PhotoPrint Service

Статус: все пункты выполнены и проверены (lint, format, 50/50 тестов, smoke)
Приоритет выполнения: A → B → C → D → E

## A. Безопасность

- [x] A1. Включить CSP в helmet — `app.js:28-31` (frame-src для карты, media-src/img-src для /uploads)
- [x] A2. CSRF-защита: формы админки + `POST /api/orders` — `app.js`, `routes/admin.js`, `routes/api.js`, `public/js/main.js`
- [x] A3. `secure: 'auto'` cookie сессии + `trust proxy` в production — `app.js:41`
- [x] A4. Ограничить `cors()` белым списком origin — `app.js:32`
- [x] A5. Отзыв JWT при logout (блоклист), роль из БД — `middleware/auth.js`, `controllers/authController.js`
- [x] A6. Смена дефолтного пароля при первом запуске, убрать `Admin123!` из README — `seeds/seed.js`, `README.md`
- [x] A7. Убрать из git `server.log`, `server.err`, `server.pid` + `.gitignore`
- [x] A8. Удалить мёртвый `routes/auth.js` (дубль логина, битая кодировка)
- [x] A9. Файловое хранилище сессий вместо MemoryStore — `app.js:37-42`

## B. Надёжность данных

- [x] B1. `sync({ alter: true })` только в development — `config/db.js:20`
- [x] B2. Express-validator для услуг/галереи — `routes/admin.js`, `controllers/serviceController.js`, `controllers/galleryController.js`
- [x] B3. Лимит итераций в `resolveUniqueSlug` — `controllers/serviceController.js:50`
- [x] B4. `POST /api/orders` возвращает только `{ success, message }` — `controllers/orderController.js:33-37`
- [x] B5. Составной индекс заявок `(status, createdAt)` вместо одиночного `status` — `migrations/0002-orders-status-created-at.js`, `models/Order.js`
- [x] B6. Составной индекс «Мои заявки» `(telegramChatId, createdAt)` вместо одиночного `telegramChatId` — `migrations/0003-orders-telegram-chat-created-at.js`, `models/Order.js`
- [x] B7. Отдельный лимит постера 8 МБ, общий лимит 25 МБ и тесты загрузки админки — `middleware/upload.js`, `routes/admin.js`, `tests/app.test.js`

## C. Производительность

- [x] C1. Кэш `getSettingsMap()` (TTL 60 с, сброс в `saveSettings`) — `app.js:79-92`, `controllers/homeController.js:14`
- [x] C2. Пагинация заявок в админке — `controllers/admin/orders.js:34`, `views/admin/orders.ejs`
- [x] C3. sitemap.xml: страницы услуг из БД — `app.js:113-116`
- [x] C4. `Cache-Control: no-store` для `/admin` — `routes/admin.js`
- [x] C5. Хешированные имена CSS/JS/шрифтов и кеш на год (`/assets/…`, `immutable`) — `tools/build-assets.js`, `utils/assets.js`, `deploy/nginx.conf.example`

## D. Качество кода и инфраструктура

- [x] D1. ESLint + `npm run lint`
- [x] D2. Prettier + `npm run format`
- [x] D3. Smoke-тесты (supertest + vitest): главная, 404, логин, заявка, отказ по валидации/CSRF
- [x] D4. GitHub Actions CI: lint + tests
- [x] D5. Обновить README (скрипты, инструкции безопасности)

## E. Улучшения сайта

- [x] E1. Пагинация/ленивая загрузка галереи (счётчик фильтра уже есть) — `views/gallery.ejs`, `public/js/gallery.js`
- [x] E2. Постер-превью для видео вместо пустого placeholder — `utils/thumbnail.js`, `controllers/galleryController.js`, `views/admin/gallery-form.ejs`
- [x] E3. canonical + og:image/og:url на публичных страницах — `views/partials/header.ejs`, у страницы услуги свой `og:image` — `utils/ogImage.js`, `controllers/serviceController.js:32`
- [x] E4. Индикатор отправки формы + honeypot — `public/js/main.js`, `views/partials/header.ejs`
- [x] E5. Страница политики конфиденциальности + ссылка в форме
- [x] E6. `theme-color` под светлую и тёмную тему сайта и админки — `views/partials/header.ejs`, `views/admin/partials/start.ejs`, `public/js/theme.js`
- [x] E7. Manrope на self-host: вариативный woff2 (OFL) в `public/vendor/manrope/`, без Google Fonts в HTML и CSP — `public/vendor/manrope/manrope.css`, `views/partials/header.ejs`, `views/admin/partials/start.ejs`, `app.js`
- [x] E8. Страница отдельной заявки и фильтр по датам в админке (фильтр дат общий для списка и CSV, `returnTo` после смены статуса с белым списком) — `controllers/admin/orders.js`, `routes/admin.js`, `views/admin/order.ejs`, `views/admin/orders.ejs`
- [x] E9. Автотест иконок: каждая `fa-*` из разметки есть в `icons.css` и в своём семействе сабсета — `tests/app.test.js`; тест сразу нашёл пустой `fa-solid fa-eye` в списке заявок (исправлен на `fa-regular`)

## Критерии готовности

- `npm run lint` и `npm test` проходят
- Админка: вход / CRUD услуг / галереи / заявок / настроек работают
- Публичный сайт: главная, услуги, галерея, контакты, отправка заявки работают
- CSP не ломает карту и загрузки; CSRF не блокирует легитимные формы

## Итоги выполнения

- `npm run lint` — 0 ошибок; `npm run format:check` — OK
- `npm test` — 50/50 (node:test + supertest)
- Smoke на живом сервере: все страницы, CSP, CSRF (формы + API), отзыв JWT, CRUD услуг
- Найден и исправлен по ходу работы баг: CSRF-проверка не видела `_csrf` в multipart-формах
  (проверка перенесена после multer: `verifyCsrfAfterUpload`), добавлен регрессионный тест
- CI: `.github/workflows/ci.yml` (lint + format + tests, Node 20/22)

# План исправлений и улучшений PhotoPrint Service

Статус: все пункты выполнены и проверены (lint, format, 13/13 тестов, smoke)
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

## C. Производительность

- [x] C1. Кэш `getSettingsMap()` (TTL 60 с, сброс в `saveSettings`) — `app.js:79-92`, `controllers/homeController.js:14`
- [x] C2. Пагинация заявок в админке — `controllers/adminController.js:213`, `views/admin/orders.ejs`
- [x] C3. sitemap.xml: страницы услуг из БД — `app.js:113-116`
- [x] C4. `Cache-Control: no-store` для `/admin` — `routes/admin.js`

## D. Качество кода и инфраструктура

- [x] D1. ESLint + `npm run lint`
- [x] D2. Prettier + `npm run format`
- [x] D3. Smoke-тесты (supertest + vitest): главная, 404, логин, заявка, отказ по валидации/CSRF
- [x] D4. GitHub Actions CI: lint + tests
- [x] D5. Обновить README (скрипты, инструкции безопасности)

## E. Улучшения сайта

- [x] E1. Пагинация/ленивая загрузка галереи (счётчик фильтра уже есть) — `views/gallery.ejs`, `public/js/gallery.js`
- [x] E2. Постер-превью для видео вместо пустого placeholder — `utils/thumbnail.js`, `controllers/galleryController.js`, `views/admin/gallery-form.ejs`
- [x] E3. canonical + og:image/og:url на публичных страницах — `views/partials/header.ejs`
- [x] E4. Индикатор отправки формы + honeypot — `public/js/main.js`, `views/partials/header.ejs`
- [x] E5. Страница политики конфиденциальности + ссылка в форме

## Критерии готовности

- `npm run lint` и `npm test` проходят
- Админка: вход / CRUD услуг / галереи / заявок / настроек работают
- Публичный сайт: главная, услуги, галерея, контакты, отправка заявки работают
- CSP не ломает карту и загрузки; CSRF не блокирует легитимные формы

## Итоги выполнения

- `npm run lint` — 0 ошибок; `npm run format:check` — OK
- `npm test` — 13/13 (node:test + supertest)
- Smoke на живом сервере: все страницы, CSP, CSRF (формы + API), отзыв JWT, CRUD услуг
- Найден и исправлен по ходу работы баг: CSRF-проверка не видела `_csrf` в multipart-формах
  (проверка перенесена после multer: `verifyCsrfAfterUpload`), добавлен регрессионный тест
- CI: `.github/workflows/ci.yml` (lint + format + tests, Node 20/22)

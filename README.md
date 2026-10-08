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

## Быстрый старт

```bash
npm install
copy .env.example .env   # Windows: задайте SESSION_SECRET и JWT_SECRET
npm run seed
npm start
```

Сервер: `http://localhost:3000`

### Переменные окружения (`.env`)

| Переменная       | Назначение                                                           |
| ---------------- | -------------------------------------------------------------------- |
| `PORT`           | Порт HTTP-сервера (по умолчанию 3000)                                |
| `NODE_ENV`       | `development` / `production`                                         |
| `SESSION_SECRET` | Секрет сессий (обязательно в проде)                                  |
| `JWT_SECRET`     | Секрет JWT-токенов (обязательно в проде)                             |
| `BASE_URL`       | Базовый URL для sitemap и canonical/OG-тегов                         |
| `CORS_ORIGINS`   | Список разрешённых origin через запятую (пусто = CORS выключен)      |
| `ADMIN_USERNAME` | Логин администратора (при `npm run seed`)                            |
| `ADMIN_PASSWORD` | Пароль администратора (обязателен для `npm run seed`)                |
| `MAIL_*`         | SMTP для уведомлений о заявках (если не заданы — почта пропускается) |

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
models/                # Service, GalleryItem, Order, Setting, User, RevokedToken
routes/                # public, admin, api
middleware/            # auth (JWT-cookie + отзыв), csrf (double-submit), upload (multer)
views/                 # EJS: публичные страницы + views/admin
public/                # css, js, uploads
seeds/seed.js          # Демо-данные
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

## Заметки

- Загруженные файлы: `public/uploads/services`, `public/uploads/gallery` (постеры — там же)
- `data/` и `public/uploads/*` (кроме `.gitkeep`) в `.gitignore` — на новом клоне выполните `npm run seed`
- `sequelize.sync({ alter: true })` выполняется только при `NODE_ENV=development`; в проде схема не изменяется автоматически — используйте миграции
- Для видео загружайте постер в форме элемента галереи (авто-генерации превью нет)

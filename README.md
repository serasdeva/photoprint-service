# PhotoPrint Service

Node.js + Express сервис фотопечати, копирования и оформления документов: публичный сайт + админ-панель.

## Возможности

### Сайт

- Страницы: главная, услуги (с детальными страницами по slug), галерея, контакты, политика конфиденциальности
- Форма заявки на сайте (`POST /api/orders`) с валидацией, honeypot-полем от спама и уведомлением на почту
- Фильтр галереи по категориям (список строится из данных), серверная пагинация «Показать ещё», постер для видео
- Загрузки обрабатываются на сервере: EXIF-поворот, ресайз до 1920 px (постеры — до 1280 px) и WebP ~82; размеры хранятся в БД и попадают в `width`/`height`
- Превью для соцсетей: `og:image` 1200×630, для услуги — её собственное изображение
- Контакты, телефон и режим работы в шапке/футере берутся из настроек админки
- Тёмная/светлая тема, адаптивная вёрстка

### Админ-панель (`/admin`)

- Вход по логину/паролю (JWT в httpOnly-cookie), выход
- Rate limit на попытки входа (5 / 15 мин)
- Дашборд: статистика и последние заявки
- Услуги: CRUD, свой slug (уникальность с суффиксом), загрузка/замена/удаление изображения
- Галерея: CRUD, фото и видео (MP4), категории с подсказками (datalist), удаление файла
- Заявки: список с фильтрами по статусу и дате, поиск по имени/телефону/услуге, страница заявки, смена статуса, удаление, экспорт в CSV (UTF-8 с BOM для Excel)
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

| Переменная          | Назначение                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `PORT`              | Порт HTTP-сервера (по умолчанию 3000)                                                      |
| `NODE_ENV`          | `development` / `production`                                                               |
| `SESSION_SECRET`    | Секрет сессий (обязательно в проде)                                                        |
| `JWT_SECRET`        | Секрет JWT-токенов (обязательно в проде)                                                   |
| `SESSION_DIR`       | Каталог файловых сессий (по умолчанию `data/sessions`)                                     |
| `BASE_URL`          | Базовый URL для sitemap и canonical/OG-тегов                                               |
| `CORS_ORIGINS`      | Список разрешённых origin через запятую (пусто = CORS выключен)                            |
| `ADMIN_USERNAME`    | Логин администратора (при `npm run seed`)                                                  |
| `ADMIN_PASSWORD`    | Пароль администратора (обязателен для `npm run seed`)                                      |
| `MAIL_*`            | SMTP для уведомлений о заявках (если не заданы — почта пропускается)                       |
| `BOT_ENABLED`       | Включить Telegram-бота (`true`/`false`)                                                    |
| `BOT_TOKEN`         | Токен бота от @BotFather (без токена бот не запускается)                                   |
| `BOT_USERNAME`      | Имя бота без `@` — для ссылки `https://t.me/…` на сайте и в панели                         |
| `BOT_ADMIN_CHAT_ID` | Chat id администратора (можно задать и в админке)                                          |
| `HEALTHCHECK_URL`   | URL проверки для мониторинга (по умолчанию `http://127.0.0.1:PORT/healthz`)                |
| `ALERT_CHAT_ID`     | Chat id для алертов мониторинга (по умолчанию `BOT_ADMIN_CHAT_ID` или настройка в админке) |

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

> Важно: приложение рассчитано на один процесс. Бот работает в режиме long polling, и несколько
> копий будут получать дубли апдейтов. Штатный деплой — systemd-юнит из `deploy/setup-vps.sh`;
> масштабирование возможно только с переходом на webhook и общую БД.

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
| `npm run build:assets` | Хешированные копии CSS/JS/шрифтов в `public/assets`             |
| `npm run seed`         | Идемпотентное наполнение БД (админ, настройки, услуги, галерея) |
| `npm run lint`         | Проверка кода ESLint                                            |
| `npm run lint:fix`     | Автоисправление ESLint                                          |
| `npm run format`       | Форматирование Prettier                                         |
| `npm run format:check` | Проверка форматирования                                         |
| `npm test`             | Тесты (node:test + supertest)                                   |
| `npm run test:e2e`     | Сквозные тесты в браузере (Playwright: desktop + mobile)        |

### Сквозные тесты (Playwright)

`npm run test:e2e` поднимает отдельный инстанс на временной БД (`tests/e2e/server.mjs`),
прогоняет сценарии в проектах `desktop` (Desktop Chrome) и `mobile` (Pixel 5) и гасит сервер.
Покрыты догрузка галереи и лайтбокс, фильтр по категории, маска телефона, переключение темы,
бургер-меню и вход в админку с живым предпросмотром настроек.

Локально нужен браузер: либо `npx playwright install chromium`, либо переменная `E2E_CHANNEL`
со значением `chrome` или `msedge` — тогда Playwright возьмёт уже установленный браузер.
В CI ставится Chromium, привязанный к версии Playwright.

## Статика и кеширование

CSS, JS и шрифты отдаются по путям вида `/assets/css/site.<hash>.css`: `npm run build:assets`
кладёт копии с 8-символьным хешем содержимого в `public/assets` (каталог в `.gitignore`) и
манифест «исходный путь → хешированный». Шаблоны получают адреса через хелпер `asset()`
(`utils/assets.js`), ссылки `url()` внутри CSS переписываются на хешированные шрифты. Сборка
запускается автоматически перед `start`, `dev` и `test`, а на VPS — в `deploy/setup-vps.sh` и
`deploy/update-vps.sh`; без манифеста шаблоны деградируют до исходных путей.

Хешированные ответы отдаются с `Cache-Control: public, max-age=31536000, immutable`, а nginx
кеширует `/assets/` на год (`expires 1y`) — имя меняется вместе с содержимым. Остальная статика
кешируется на час, а `/uploads` — на 30 дней с `immutable`: имена файлов уникальны и не переиспользуются.

## Безопасность

- **CSP** через Helmet: скрипты только с `'self'`, запрещён `object-src`, `frame-ancestors 'self'`
- **CSRF**: double-submit токен в cookie + `_csrf` в формах и заголовок `x-csrf-token` в API
- **JWT**: httpOnly-cookie, отзыв при выходе (таблица `RevokedTokens`), роль читается из БД
- **Загрузки**: белый список расширений и MIME, лимиты размера, запрет отдачи `.html/.js/.svg` из `/uploads`
- **Rate limit**: вход (5/15 мин), просмотр админки (600/15 мин), API: чтение (300/15 мин) и заявки (20/15 мин)
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
public/                # css, js, uploads, vendor/fontawesome (сабсет иконок)
telegram/              # Бот: config, bot, notifications, keyboards, handlers/*
seeds/seed.js          # Демо-данные
tools/                 # build-fontawesome.py — сборка сабсета иконок
migrations/            # Изменения схемы существующей БД (индексы и т.п.)
tests/                 # node:test + supertest; tests/e2e — Playwright
.github/workflows/     # CI: lint + format check + tests + e2e
utils/                 # asyncHandler, mailer, slugify, uploads
```

## Технологии

- Node.js 20.17+, Express 5, EJS, Sequelize + SQLite
- JWT + cookie auth, express-session, connect-flash
- Multer (загрузка файлов), Helmet, express-rate-limit, express-validator
- Nodemailer (опционально), bcryptjs 3
- Vanilla JS + собственный CSS (light/dark)
- Font Awesome 6.5.2 — локальный сабсет, без CDN

## Эксплуатация

- `GET /healthz` — проверка живости: `{ "status": "ok", "db": "ok", "uptime": N }`, при недоступной БД возвращает `503`.
- Мониторинг: systemd-таймер раз в минуту проверяет `/healthz` и при падении пишет в Telegram (один алерт на сбой + сообщение о восстановлении). `OnFailure=` в drop-in сервиса ловит аварийные завершения, journald ограничен 500 МБ. Устанавливается `deploy/install-monitoring.sh` из `setup-vps.sh`/`update-vps.sh`.
- `SIGTERM`/`SIGINT` обрабатываются в `server.js`: сервер перестаёт принимать соединения, бот останавливается, SQLite закрывается (жёсткий таймаут — 10 с).
- SQLite работает в режиме WAL с `busy_timeout = 5000`, поэтому сайт и бот могут писать одновременно.
- Миграции: `sequelize.sync()` создаёт недостающие таблицы, а изменения существующей схемы (индексы, новые колонки) лежат в `migrations/*.js` и применяются при старте. Учёт — в таблице `_schema_migrations`, повторный запуск ничего не делает.
- Сессии сайта и диалоги бота чистятся автоматически: просроченные файлы в `data/sessions` и `data/telegram-sessions` удаляются при старте и по таймеру.
- Приложение слушает интерфейс из `HOST` (на VPS — `127.0.0.1`, наружу смотрит только nginx).
- Бэкапы: `deploy/install-backup.sh` ставит ежедневный таймер на 03:30 UTC — см. раздел ниже.

## Мониторинг и алерты

`deploy/install-monitoring.sh` ставит на VPS:

- `photoprint-healthcheck.timer` — раз в минуту запускает `deploy/healthcheck.sh`; он проверяет
  `/healthz` и шлёт в Telegram один алерт на сбой (повтор — не чаще раза в час) и отдельное
  сообщение о восстановлении;
- `photoprint-alert@.service` + `OnFailure=` в drop-in основного сервиса — мгновенный алерт,
  если systemd-юнит упал;
- drop-in journald с `SystemMaxUse=500M` и `SystemMaxFileSize=50M`.

Для алертов нужны `BOT_TOKEN` и chat id: `ALERT_CHAT_ID` из `.env`, иначе `BOT_ADMIN_CHAT_ID`,
иначе значение из настроек Telegram в админке (его скрипт читает из SQLite через `sqlite3`).

Проверить отправку и статус:

```bash
sudo -u photoprint /usr/local/bin/photoprint-healthcheck.sh --test
sudo systemctl status photoprint-healthcheck.timer
sudo journalctl -u photoprint-healthcheck.service -n 50 --no-pager
```

Таймер живёт на том же VPS, поэтому видит падение приложения, но не падение самого сервера.
Для полного внешнего контроля настройте сторонний uptime-сервис на `https://<домен>/healthz`
с уведомлением в Telegram; ответ `503` означает недоступную БД.

## Бэкапы и восстановление

`deploy/install-backup.sh` (вызывается из `setup-vps.sh` и `update-vps.sh`) ставит
`photoprint-backup.timer`: ежедневно в 03:30 UTC `deploy/backup.sh` делает согласованный
снимок базы (`sqlite3 .backup` + `PRAGMA integrity_check`), архивирует `public/uploads`
и хранит 14 последних запусков в `/var/backups/photoprint-service/`.

```bash
sudo systemctl start photoprint-backup.service   # бэкап прямо сейчас
sudo bash deploy/restore.sh /var/backups/photoprint-service/20261101T033000Z
```

Восстановление проверяет дамп, останавливает сервис, переносит текущие базу и uploads
в `data/pre-restore-<время>/`, убирает устаревшие `-wal`/`-shm`, разворачивает копию и ждёт
`/healthz`. Битый бэкап отклоняется до остановки сервиса. Бэкапы лежат на том же VPS —
их нужно вывозить наружу (снапшоты провайдера, `rclone`, S3/B2) и раз в сезон проверять
восстановление на копии.

## Шрифт Manrope

Шрифт тоже отдаётся с нашего сервера, Google Fonts в CSP больше нет: `public/vendor/manrope/{manrope.css,OFL.txt}`
и четыре вариативных woff2 (400–800) — подсеты cyrillic, cyrillic-ext, latin, latin-ext, всего ~56 КБ.
`manrope.css` подключён в шапке сайта и админки, кириллический файл предзагружается.

Обновить шрифт: скачать woff2 из Google Fonts (CSS API с `wght@400..800`), заменить файлы с теми же
именами и сверить `unicode-range` в `manrope.css`. Лицензия — SIL OFL 1.1, текст лежит рядом.

## Иконки Font Awesome (сабсет)

Иконки отдаются с нашего сервера, CDN не используется: `public/vendor/fontawesome/{icons.css,webfonts/*.woff2}`. Полный дистрибутив (~100 КБ CSS + ~290 КБ шрифтов) не тянем — в сабсете только нужные глифы (CSS ≤ 10 КБ).

Сборка:

```bash
# 1. Скачать FA 6.5.2: css/all.min.css и webfonts/fa-{solid-900,regular-400,brands-400}.woff2
# 2. Собрать сабсет (нужен Python 3 + fontTools + brotli):
python -m venv .venv-fa && .venv-fa/Scripts/pip install fonttools brotli
.venv-fa/Scripts/python tools/build-fontawesome.py --src <каталог-с-дистрибутивом>
```

Скрипт берёт имена иконок из `USED_IN_APP` (реально используемые) и `EXTRAS` (запас для поля «Иконка» в админке), вырезает глифы из woff2 и пишет компактный CSS. Если нужной иконки нет в списке — добавьте её туда и перезапустите; иконки вне сабсета не отрисуются. На ошибку скрипт падает с внятным сообщением: не найденного в FA имени либо глифа, которого нет в выбранном стиле (часть иконок в FA Free существует только в solid).

Поле «Иконка (Font Awesome)» в админке — свободный текст: оно ограничено сабсетом (168 solid / 29 regular / 10 brands), в FA Free отсутствуют `sparkles`, `printer`, `monitor`.

## Заметки

- Загруженные файлы: `public/uploads/services`, `public/uploads/gallery` (постеры — там же)
- `data/`, `public/uploads/*` (кроме `.gitkeep`) и `public/assets/` в `.gitignore` — на новом клоне выполните `npm run seed`
- `sequelize.sync({ alter: true })` выполняется только при `NODE_ENV=development`; в проде таблицы создаются через `sync()`, а изменения схемы — только через `migrations/`
- Для видео загружайте постер в форме элемента галереи (авто-генерации превью нет)

require('dotenv').config({ quiet: true });

const express = require('express');
const path = require('path');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const FileSessionStore = require('./utils/fileSessionStore');
const { asset } = require('./utils/assets');
const flash = require('connect-flash');

const { sequelize, syncDatabase } = require('./config/db');
const { runMigrations } = require('./config/migrations');
const { getSettingsMap } = require('./controllers/homeController');
const { ensureCsrfCookie, verifyCsrf } = require('./middleware/csrf');
const asyncHandler = require('./utils/asyncHandler');
const { Service } = require('./models');
const indexRouter = require('./routes/index');
const servicesRouter = require('./routes/services');
const galleryRouter = require('./routes/gallery');
const contactsRouter = require('./routes/contacts');
const adminRouter = require('./routes/admin');
const apiRouter = require('./routes/api');

const app = express();

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required');
}

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'"],
        'frame-src': ['https:'],
        'frame-ancestors': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
);
if (allowedOrigins.length) {
  app.use(cors({ origin: allowedOrigins, credentials: false }));
}
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
const sessionStore = new FileSessionStore({
  // SESSION_DIR позволяет тестам и нестандартным деплоям держать сессии вне каталога проекта.
  path: process.env.SESSION_DIR || path.join(__dirname, 'data', 'sessions'),
  ttl: 7 * 24 * 60 * 60,
  logFn: (error) => console.error('Session store error:', error.message),
});
// Просроченные файлы сессий иначе остаются на диске навсегда: удаляем их при старте и раз в 6 часов.
sessionStore.prune();
setInterval(() => sessionStore.prune(), 6 * 60 * 60 * 1000).unref();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(flash());
app.use(ensureCsrfCookie);
app.use(verifyCsrf);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const legacyPlaceholderFiles = {
  '/uploads/gallery/sample-1.svg': 'sample-1.svg',
  '/uploads/gallery/sample-2.svg': 'sample-2.svg',
  '/uploads/gallery/sample-3.svg': 'sample-3.svg',
  '/uploads/gallery/sample-4.svg': 'sample-4.svg',
  '/uploads/services/service-default.svg': 'service-default.svg',
};

app.get(Object.keys(legacyPlaceholderFiles), (req, res, next) => {
  res.sendFile(
    path.join(__dirname, 'public', 'gallery-placeholders', legacyPlaceholderFiles[req.path]),
    (error) => {
      if (error) next(error);
    }
  );
});

app.use(
  '/uploads',
  express.static(path.join(__dirname, 'public', 'uploads'), {
    index: false,
    // Имена файлов содержат метку времени и случайный хвост и никогда не переиспользуются,
    // поэтому галерея может кешироваться надолго: иначе каждая фотография перепроверялась бы.
    maxAge: '30d',
    immutable: true,
    setHeaders(res, filePath) {
      const forbiddenExtensions = ['.html', '.htm', '.svg', '.xml', '.js', '.json', '.css'];
      const ext = path.extname(filePath).toLowerCase();

      if (forbiddenExtensions.includes(ext)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
    },
  })
);
const ASSETS_DIR = path.join(__dirname, 'public', 'assets');
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      // Имя файла в /assets меняется вместе с содержимым, поэтому кешируем его на год.
      if (filePath.startsWith(`${ASSETS_DIR}${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

app.use(async (req, res, next) => {
  res.locals.flash = req.flash();
  res.locals.user = req.user || null;
  res.locals.currentYear = new Date().getFullYear();
  res.locals.asset = asset;

  const baseUrl = (process.env.BASE_URL || '').replace(/\/+$/, '');
  const origin = baseUrl || `${req.protocol}://${req.get('host')}`;
  // canonical без query: страницы поиска (`?q=`) не должны индексироваться как отдельные URL.
  res.locals.canonicalUrl = `${origin}${req.path}`;
  res.locals.noindex = typeof req.query.q === 'string' && req.query.q.trim() !== '';
  res.locals.origin = origin;
  res.locals.ogImage = `${origin}/og-image.png`;
  // Габариты известны только для дефолтной карточки; страница услуги подменяет их на null.
  res.locals.ogImageWidth = 1200;
  res.locals.ogImageHeight = 630;

  const botUsername = String(process.env.BOT_USERNAME || '')
    .replace(/^@/, '')
    .trim();
  res.locals.telegramUrl = botUsername ? `https://t.me/${botUsername}` : '';

  try {
    res.locals.settings = await getSettingsMap();
  } catch (error) {
    console.error('Settings load failed:', error.message);
    res.locals.settings = {};
  }

  next();
});

app.get('/healthz', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  try {
    await sequelize.query('SELECT 1');
    return res.json({ status: 'ok', db: 'ok', uptime: Math.round(process.uptime()) });
  } catch (error) {
    console.error('Health check failed:', error.message);
    return res.status(503).json({ status: 'error', db: 'unavailable' });
  }
});

// Read/write лимитеры раздельные и объявлены в routes/api.js: общий лимитер на весь /api
// заставлял листание галереи съедать квоту отправки заявок.

app.use('/', indexRouter);
app.use('/services', servicesRouter);
app.use('/gallery', galleryRouter);
app.use('/contacts', contactsRouter);
app.use('/admin', adminRouter);
app.use('/api', apiRouter);

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n');
});

app.get(
  '/sitemap.xml',
  asyncHandler(async (req, res) => {
    const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const services = await Service.findAll({
      where: { isActive: true },
      attributes: ['slug', 'updatedAt'],
      order: [['order', 'ASC']],
      raw: true,
    });

    // lastmod помогаем поисковику понять, что страница услуги обновилась.
    const toLastmod = (value) => {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };

    const paths = [
      { pathname: '/', lastmod: null },
      { pathname: '/services', lastmod: null },
      { pathname: '/gallery', lastmod: null },
      { pathname: '/contacts', lastmod: null },
      { pathname: '/privacy', lastmod: null },
    ].concat(
      services.map((service) => ({
        pathname: `/services/${service.slug}`,
        lastmod: toLastmod(service.updatedAt),
      }))
    );

    const entries = paths
      .map(({ pathname, lastmod }) => {
        const lastmodTag = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
        return `  <url><loc>${base}${pathname}</loc>${lastmodTag}</url>`;
      })
      .join('\n');

    res.type('application/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`
    );
  })
);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Страница не найдена' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).render('500', {
    title: 'Ошибка сервера',
    // В продакшене не отдаём текст ошибки наружу: в нём бывают пути и детали SQL.
    error: process.env.NODE_ENV === 'production' ? null : err.message,
  });
});

async function startApp() {
  await syncDatabase();
  await runMigrations({ sequelize, queryInterface: sequelize.getQueryInterface() });
  return app;
}

module.exports = { app, startApp };

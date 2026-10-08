require('dotenv').config();

const express = require('express');
const path = require('path');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const FileSessionStore = require('./utils/fileSessionStore');
const flash = require('connect-flash');
const rateLimit = require('express-rate-limit');

const { syncDatabase } = require('./config/db');
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
        'style-src': [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
        ],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
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
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new FileSessionStore({
      path: path.join(__dirname, 'data', 'sessions'),
      ttl: 7 * 24 * 60 * 60,
      logFn: (error) => console.error('Session store error:', error.message),
    }),
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
app.use(express.static(path.join(__dirname, 'public')));

app.use(async (req, res, next) => {
  res.locals.flash = req.flash();
  res.locals.user = req.user || null;
  res.locals.currentYear = new Date().getFullYear();

  const baseUrl = (process.env.BASE_URL || '').replace(/\/+$/, '');
  res.locals.canonicalUrl = baseUrl
    ? `${baseUrl}${req.originalUrl}`
    : `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  res.locals.ogImage = `${baseUrl || `${req.protocol}://${req.get('host')}`}/favicon.svg`;

  try {
    res.locals.settings = await getSettingsMap();
  } catch (error) {
    console.error('Settings load failed:', error.message);
    res.locals.settings = {};
  }

  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Слишком много запросов. Попробуйте позже.',
});
app.use('/api', apiLimiter);

app.use('/', indexRouter);
app.use('/services', servicesRouter);
app.use('/gallery', galleryRouter);
app.use('/contacts', contactsRouter);
app.use('/admin', adminRouter);
app.use('/api', apiRouter);

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\n');
});

app.get(
  '/sitemap.xml',
  asyncHandler(async (req, res) => {
    const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const services = await Service.findAll({ attributes: ['slug'], raw: true });
    const paths = ['/', '/services', '/gallery', '/contacts', '/privacy'].concat(
      services.map((service) => `/services/${service.slug}`)
    );

    const entries = paths
      .map((pathname) => `  <url><loc>${base}${pathname}</loc></url>`)
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
  res.status(500).render('500', { title: 'Ошибка сервера', error: err.message });
});

async function startApp() {
  await syncDatabase();
  return app;
}

module.exports = { app, startApp };

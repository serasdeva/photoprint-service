const crypto = require('crypto');

const CSRF_COOKIE = 'csrf_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HEADER_NAME = 'x-csrf-token';

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function ensureCsrfCookie(req, res, next) {
  const existing = req.cookies[CSRF_COOKIE];
  const token = typeof existing === 'string' && existing.length === 64 ? existing : generateToken();

  if (token !== existing) {
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  req.csrfToken = token;
  res.locals.csrfToken = token;
  next();
}

function csrfCheck(req, res, next) {
  const bodyToken = req.body && req.body._csrf;
  const headerToken = req.get(HEADER_NAME);
  const cookieToken = req.cookies[CSRF_COOKIE];
  const provided = bodyToken || headerToken;

  if (!provided || !tokensMatch(provided, cookieToken)) {
    const acceptsHtml = (req.get('accept') || '').includes('text/html');
    if (acceptsHtml) {
      req.flash('error', 'Недействительный токен формы. Обновите страницу и попробуйте снова.');
      const fallbackUrl = req.get('Referrer') || req.originalUrl || '/';
      return res.redirect(fallbackUrl);
    }
    return res.status(403).json({ success: false, message: 'CSRF token mismatch' });
  }

  return next();
}

// Глобальная проверка: multipart/form-data ещё не разобран — его проверяет verifyCsrfAfterUpload
function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  if ((req.get('content-type') || '').includes('multipart/form-data')) {
    return next();
  }
  return csrfCheck(req, res, next);
}

// Проверка после multer: req.body._csrf доступен
function verifyCsrfAfterUpload(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  return csrfCheck(req, res, next);
}

module.exports = { CSRF_COOKIE, ensureCsrfCookie, verifyCsrf, verifyCsrfAfterUpload };

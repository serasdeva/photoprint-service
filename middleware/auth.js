const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { User, RevokedToken } = require('../models');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  return secret;
}

function signToken(payload) {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '30d',
  });
}

async function isTokenRevoked(jti) {
  if (!jti) {
    return true;
  }
  const record = await RevokedToken.findOne({ where: { jti } });
  return Boolean(record);
}

async function revokeToken(token) {
  if (!token) {
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), { ignoreExpiration: true });
    if (!decoded.jti) {
      return;
    }

    await RevokedToken.findOrCreate({
      where: { jti: decoded.jti },
      defaults: {
        jti: decoded.jti,
        expiresAt: new Date((decoded.exp || Math.floor(Date.now() / 1000)) * 1000),
      },
    });

    await RevokedToken.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
  } catch (error) {
    console.error('Token revoke failed:', error.message);
  }
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.auth_token;

    if (!token) {
      req.flash('error', 'Требуется авторизация');
      return res.redirect('/admin/login');
    }

    const decoded = jwt.verify(token, getJwtSecret());

    if (await isTokenRevoked(decoded.jti)) {
      res.clearCookie('auth_token');
      req.flash('error', 'Сессия истекла. Войдите снова.');
      return res.redirect('/admin/login');
    }

    const user = await User.findByPk(decoded.id);
    if (!user) {
      res.clearCookie('auth_token');
      req.flash('error', 'Сессия истекла. Войдите снова.');
      return res.redirect('/admin/login');
    }

    req.user = { id: user.id, username: user.username, role: user.role };
    res.locals.user = req.user;
    return next();
  } catch (error) {
    req.flash('error', 'Сессия истекла. Войдите снова.');
    return res.redirect('/admin/login');
  }
}

module.exports = { requireAuth, signToken, revokeToken };

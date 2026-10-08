const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { signToken, revokeToken } = require('../middleware/auth');

async function loginPage(req, res) {
  res.render('admin/login', { title: 'Вход в админку', activePage: 'login' });
}

async function loginUser(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    req.flash('error', 'Введите логин и пароль');
    return res.redirect('/admin/login');
  }

  const user = await User.findOne({ where: { username } });

  if (!user) {
    req.flash('error', 'Неверные учетные данные');
    return res.redirect('/admin/login');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);

  if (!isMatch) {
    req.flash('error', 'Неверные учетные данные');
    return res.redirect('/admin/login');
  }

  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  req.flash('success', 'Добро пожаловать');
  return res.redirect('/admin');
}

async function logoutUser(req, res) {
  await revokeToken(req.cookies.auth_token);
  res.clearCookie('auth_token');
  req.flash('success', 'Вы вышли из системы');
  return res.redirect('/admin/login');
}

module.exports = { loginPage, loginUser, logoutUser };

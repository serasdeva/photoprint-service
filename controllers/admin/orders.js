const { Op } = require('sequelize');
const { Order } = require('../../models');
const { filterByTerm, paginate } = require('../../utils/search');
const { toCsv, formatDateTime, formatFileDate } = require('../../utils/csv');
const { notifyClientStatusChange } = require('../../telegram/notifications');

const ORDER_STATUSES = ['new', 'in_progress', 'done'];
const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;
const ORDER_EXPORT_COLUMNS = [
  'id',
  'createdAt',
  'name',
  'phone',
  'email',
  'service',
  'message',
  'status',
  'source',
];

// Даты в форме — локальные календарные дни, как и вывод в таблице. Невалидную дату
// (например, 2026-02-31) игнорируем, чтобы не отдавать пустой список из-за опечатки.
function parseDateInput(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = DATE_INPUT.exec(value.trim());
  if (!match) {
    return null;
  }

  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  const isSameDay =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;

  return isSameDay ? date : null;
}

// Список и экспорт обязаны фильтровать одинаково, иначе «Скачать CSV» выдаст не то, что видит админ.
async function findFilteredOrders(query) {
  const where = {};
  const status = typeof query.status === 'string' ? query.status : '';

  if (status && ORDER_STATUSES.includes(status)) {
    where.status = status;
  }

  let fromValue = typeof query.from === 'string' ? query.from.trim() : '';
  let toValue = typeof query.to === 'string' ? query.to.trim() : '';
  let fromDate = parseDateInput(fromValue);
  let toDate = parseDateInput(toValue);

  fromValue = fromDate ? fromValue : '';
  toValue = toDate ? toValue : '';

  // Перепутанные границы трактуем как обычный диапазон, а не как «ничего не найдено».
  if (fromDate && toDate && fromDate > toDate) {
    [fromDate, toDate] = [toDate, fromDate];
    [fromValue, toValue] = [toValue, fromValue];
  }

  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) {
      where.createdAt[Op.gte] = fromDate;
    }
    if (toDate) {
      // Верхняя граница включительна для выбранного дня: [начало from, начало следующего дня to).
      const nextDay = new Date(toDate);
      nextDay.setDate(nextDay.getDate() + 1);
      where.createdAt[Op.lt] = nextDay;
    }
  }

  const term = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
  const rows = await Order.findAll({ where, order: [['createdAt', 'DESC']], raw: true });
  // SQLite LIKE не учитывает регистр кириллицы, поэтому поиск остаётся на стороне JS.
  return {
    rows: filterByTerm(rows, term, ['name', 'phone', 'email', 'service']),
    term,
    status,
    from: fromValue,
    to: toValue,
  };
}

async function renderOrdersPage(req, res) {
  const { rows, term, status, from, to } = await findFilteredOrders(req.query);
  const { items, pagination } = paginate(rows, req.query.page, 20);

  res.render('admin/orders', {
    title: 'Заявки',
    orders: items,
    filters: { status: status || '', q: term, from, to },
    pagination,
    activePage: 'orders',
  });
}

async function renderOrderPage(req, res) {
  const order = await Order.findByPk(req.params.id);

  if (!order) {
    req.flash('error', 'Заявка не найдена');
    return res.redirect('/admin/orders');
  }

  res.render('admin/order', {
    title: `Заявка #${order.id}`,
    order,
    activePage: 'orders',
  });
}

async function exportOrdersCsv(req, res) {
  const { rows } = await findFilteredOrders(req.query);

  const dataRows = rows.map((order) =>
    ORDER_EXPORT_COLUMNS.map((column) =>
      column === 'createdAt' ? formatDateTime(order.createdAt) : order[column]
    )
  );

  // Имя файла только ASCII: кириллица в Content-Disposition требует filename*=UTF-8''...
  const filename = `orders-${formatFileDate(new Date())}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(ORDER_EXPORT_COLUMNS, dataRows));
}

// Форма на странице заявки возвращает туда же; любой другой адрес — в список.
function safeReturnPath(value) {
  return typeof value === 'string' && /^\/admin\/orders(?:\/\d+)?$/.test(value)
    ? value
    : '/admin/orders';
}

async function updateOrderStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const wantsJson = req.method === 'PATCH';
  const returnTo = safeReturnPath(req.body.returnTo);

  try {
    if (!ORDER_STATUSES.includes(status)) {
      throw new Error('Недопустимый статус');
    }

    const order = await Order.findByPk(id);
    if (!order) {
      if (wantsJson) {
        return res.status(404).json({ success: false, message: 'Заявка не найдена' });
      }
      req.flash('error', 'Заявка не найдена');
      return res.redirect(returnTo);
    }

    await order.update({ status });

    try {
      await notifyClientStatusChange(order.toJSON());
    } catch (telegramError) {
      console.error('Telegram client notify failed:', telegramError.message);
    }

    if (wantsJson) {
      return res.json({ success: true, order });
    }

    req.flash('success', 'Статус заявки обновлён');
    return res.redirect(returnTo);
  } catch (error) {
    if (wantsJson) {
      return res.status(400).json({ success: false, message: error.message });
    }
    req.flash('error', 'Не удалось обновить статус заявки');
    return res.redirect(returnTo);
  }
}

async function deleteOrder(req, res) {
  const { id } = req.params;
  const order = await Order.findByPk(id);

  if (!order) {
    req.flash('error', 'Заявка не найдена');
    return res.redirect('/admin/orders');
  }

  await order.destroy();
  req.flash('success', 'Заявка удалена');
  return res.redirect('/admin/orders');
}

module.exports = {
  renderOrdersPage,
  renderOrderPage,
  exportOrdersCsv,
  updateOrderStatus,
  deleteOrder,
};

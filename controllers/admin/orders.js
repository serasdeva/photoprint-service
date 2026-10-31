const { Order } = require('../../models');
const { filterByTerm, paginate } = require('../../utils/search');
const { toCsv, formatDateTime, formatFileDate } = require('../../utils/csv');
const { notifyClientStatusChange } = require('../../telegram/notifications');

const ORDER_STATUSES = ['new', 'in_progress', 'done'];
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

// Список и экспорт обязаны фильтровать одинаково, иначе «Скачать CSV» выдаст не то, что видит админ.
async function findFilteredOrders(query) {
  const where = {};
  const status = typeof query.status === 'string' ? query.status : '';

  if (status && ORDER_STATUSES.includes(status)) {
    where.status = status;
  }

  const term = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
  const rows = await Order.findAll({ where, order: [['createdAt', 'DESC']], raw: true });
  // SQLite LIKE не учитывает регистр кириллицы, поэтому поиск остаётся на стороне JS.
  return { rows: filterByTerm(rows, term, ['name', 'phone', 'email', 'service']), term, status };
}

async function renderOrdersPage(req, res) {
  const { rows, term, status } = await findFilteredOrders(req.query);
  const { items, pagination } = paginate(rows, req.query.page, 20);

  res.render('admin/orders', {
    title: 'Заявки',
    orders: items,
    filters: { status: status || '', q: term },
    pagination,
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

async function updateOrderStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const wantsJson = req.method === 'PATCH';

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
      return res.redirect('/admin/orders');
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
    return res.redirect('/admin/orders');
  } catch (error) {
    if (wantsJson) {
      return res.status(400).json({ success: false, message: error.message });
    }
    req.flash('error', 'Не удалось обновить статус заявки');
    return res.redirect('/admin/orders');
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
  exportOrdersCsv,
  updateOrderStatus,
  deleteOrder,
};

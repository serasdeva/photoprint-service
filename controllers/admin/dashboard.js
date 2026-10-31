const { Service, GalleryItem, Order } = require('../../models');

async function renderDashboard(req, res) {
  const [services, galleryItems, totalOrders, newOrdersCount, newOrders, orders] =
    await Promise.all([
      Service.count(),
      GalleryItem.count(),
      Order.count(),
      Order.count({ where: { status: 'new' } }),
      Order.findAll({
        where: { status: 'new' },
        order: [['createdAt', 'DESC']],
        limit: 5,
        raw: true,
      }),
      Order.findAll({ order: [['createdAt', 'DESC']], limit: 8, raw: true }),
    ]);

  res.render('admin/dashboard', {
    title: 'Панель управления',
    stats: {
      services,
      galleryItems,
      orders: totalOrders,
      newOrders: newOrdersCount,
    },
    newOrders,
    recentOrders: orders,
    activePage: 'dashboard',
  });
}

module.exports = { renderDashboard };

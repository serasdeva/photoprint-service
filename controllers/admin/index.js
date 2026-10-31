// Точки входа админки разнесены по доменам; index сохраняет прежний набор имён,
// поэтому routes/admin.js импортирует их одним require вместо четырёх.
const dashboard = require('./dashboard');
const catalog = require('./catalog');
const orders = require('./orders');
const settings = require('./settings');

module.exports = {
  ...dashboard,
  ...catalog,
  ...orders,
  ...settings,
};

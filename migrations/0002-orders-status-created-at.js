// Заявки в админке и на дашборде читают как `WHERE status = ? ORDER BY createdAt DESC`, и
// одиночный индекс по status оставлял планировщику только `USE TEMP B-TREE FOR ORDER BY`.
// Составной (status, createdAt) закрывает и фильтр, и сортировку одним проходом, а старый
// orders_status_idx становится избыточным: запросы только по status используют префикс
// нового индекса (проверено EXPLAIN QUERY PLAN на копии базы — планы не ухудшились).
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS orders_status_created_at_idx ON Orders (status, createdAt);'
    );
    await sequelize.query('DROP INDEX IF EXISTS orders_status_idx;');
  },
};

// «Мои заявки» в боте читают как `WHERE telegramChatId = ? ORDER BY createdAt DESC LIMIT 10`,
// и одиночный индекс по telegramChatId оставлял планировщику `USE TEMP B-TREE FOR ORDER BY`.
// Составной (telegramChatId, createdAt) закрывает и фильтр, и сортировку; других запросов
// по одному chat id в коде нет, поэтому старый orders_telegram_chat_id_idx удаляется.
// План до/после (EXPLAIN QUERY PLAN на копии базы):
// `SEARCH … USING INDEX orders_telegram_chat_id_idx + USE TEMP B-TREE FOR ORDER BY` →
// `SEARCH … USING INDEX orders_telegram_chat_created_at_idx`, временная сортировка не нужна.
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS orders_telegram_chat_created_at_idx ON Orders (telegramChatId, createdAt);'
    );
    await sequelize.query('DROP INDEX IF EXISTS orders_telegram_chat_id_idx;');
  },
};

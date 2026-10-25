// Индексы под реальные запросы админки и бота: фильтр по статусу, сортировка по дате
// и выборка заявок клиента Telegram. IF NOT EXISTS — чтобы миграция была безопасной
// для баз, где индексы уже созданы вручную.
module.exports = {
  async up({ sequelize }) {
    await sequelize.query('CREATE INDEX IF NOT EXISTS orders_status_idx ON Orders (status);');
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS orders_created_at_idx ON Orders (createdAt);'
    );
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS orders_telegram_chat_id_idx ON Orders (telegramChatId);'
    );
  },
};

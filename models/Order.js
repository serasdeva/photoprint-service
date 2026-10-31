const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Order = sequelize.define(
  'Order',
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '',
    },
    service: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '',
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: '',
    },
    status: {
      type: DataTypes.ENUM('new', 'in_progress', 'done'),
      allowNull: false,
      defaultValue: 'new',
    },
    source: {
      type: DataTypes.ENUM('site', 'telegram'),
      allowNull: false,
      defaultValue: 'site',
    },
    telegramChatId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    telegramUserId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: 'Orders',
    // Дублируются миграциями 0001–0003: sync() нужен для свежих баз и development,
    // миграция — для уже существующих баз в продакшене.
    indexes: [
      // Один индекс на (status, createdAt): он же закрывает фильтр только по status.
      { name: 'orders_status_created_at_idx', fields: ['status', 'createdAt'] },
      { name: 'orders_created_at_idx', fields: ['createdAt'] },
      // «Мои заявки» бота: фильтр по chat id плюс сортировка по дате без временной B-tree.
      {
        name: 'orders_telegram_chat_created_at_idx',
        fields: ['telegramChatId', 'createdAt'],
      },
    ],
  }
);

module.exports = { Order };

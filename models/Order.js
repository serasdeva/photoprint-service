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
    // Дублируются миграцией 0001: sync() нужен для свежих баз и development,
    // миграция — для уже существующих баз в продакшене.
    indexes: [
      { name: 'orders_status_idx', fields: ['status'] },
      { name: 'orders_created_at_idx', fields: ['createdAt'] },
      { name: 'orders_telegram_chat_id_idx', fields: ['telegramChatId'] },
    ],
  }
);

module.exports = { Order };

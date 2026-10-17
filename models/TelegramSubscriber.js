const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const TelegramSubscriber = sequelize.define(
  'TelegramSubscriber',
  {
    chatId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
      },
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '',
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '',
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    timestamps: true,
    tableName: 'TelegramSubscribers',
  }
);

module.exports = { TelegramSubscriber };

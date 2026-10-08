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
  },
  {
    timestamps: true,
    tableName: 'Orders',
  }
);

module.exports = { Order };

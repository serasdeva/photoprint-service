const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const RevokedToken = sequelize.define(
  'RevokedToken',
  {
    jti: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    timestamps: true,
    tableName: 'RevokedTokens',
  }
);

module.exports = { RevokedToken };

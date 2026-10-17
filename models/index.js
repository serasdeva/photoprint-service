const { sequelize } = require('../config/db');
const { Service } = require('./Service');
const { GalleryItem } = require('./GalleryItem');
const { Order } = require('./Order');
const { User } = require('./User');
const { Setting } = require('./Setting');
const { RevokedToken } = require('./RevokedToken');
const { TelegramSubscriber } = require('./TelegramSubscriber');

module.exports = {
  sequelize,
  Service,
  GalleryItem,
  Order,
  User,
  Setting,
  RevokedToken,
  TelegramSubscriber,
};

const { FAQ } = require('./texts');

const CALLBACK = {
  orderNew: 'order:new',
  menu: 'menu:main',
  faqPrefix: 'faq:',
  broadcastSend: 'broadcast:send',
  broadcastCancel: 'broadcast:cancel',
};

function mainMenuKeyboard({ isAdmin = false, deepLink = '' } = {}) {
  const rows = [
    [
      { text: '🖨 Услуги и цены', callback_data: 'menu:services' },
      { text: '🖼 Галерея', callback_data: 'menu:gallery' },
    ],
    [{ text: '📝 Оставить заявку', callback_data: CALLBACK.orderNew }],
    [
      { text: '📦 Мои заявки', callback_data: 'menu:myorders' },
      { text: '❓ FAQ', callback_data: 'menu:faq' },
    ],
    [
      { text: '☎️ Контакты', callback_data: 'menu:contacts' },
      { text: '🔔 Подписка', callback_data: 'menu:subscribe' },
    ],
  ];

  if (deepLink) {
    rows.push([{ text: '🌐 Открыть сайт', url: deepLink }]);
  }
  if (isAdmin) {
    rows.push([{ text: '🛠 Админ-меню', callback_data: 'menu:admin' }]);
  }

  return { inline_keyboard: rows };
}

function backToMenuKeyboard() {
  return { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: CALLBACK.menu }]] };
}

function phoneShareKeyboard() {
  return {
    keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function servicesKeyboard(services) {
  const rows = services.map((service) => [
    { text: `📌 ${service.title}`, callback_data: `order:service:${service.id}` },
  ]);
  rows.push([{ text: '⬅️ В меню', callback_data: CALLBACK.menu }]);
  return { inline_keyboard: rows };
}

function confirmOrderKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Подтвердить', callback_data: 'order:confirm' }],
      [{ text: '❌ Отменить', callback_data: 'order:cancel' }],
    ],
  };
}

function skipCommentKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Пропустить', callback_data: 'order:skip' }],
      [{ text: '❌ Отменить', callback_data: 'order:cancel' }],
    ],
  };
}

function faqKeyboard() {
  const rows = FAQ.map((item) => [{ text: item.title, callback_data: `faq:${item.key}` }]);
  rows.push([{ text: '⬅️ В меню', callback_data: CALLBACK.menu }]);
  return { inline_keyboard: rows };
}

function broadcastConfirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📣 Отправить', callback_data: CALLBACK.broadcastSend }],
      [{ text: '❌ Отмена', callback_data: CALLBACK.broadcastCancel }],
    ],
  };
}

function removeKeyboard() {
  return { remove_keyboard: true };
}

module.exports = {
  CALLBACK,
  mainMenuKeyboard,
  backToMenuKeyboard,
  phoneShareKeyboard,
  servicesKeyboard,
  confirmOrderKeyboard,
  skipCommentKeyboard,
  faqKeyboard,
  broadcastConfirmKeyboard,
  removeKeyboard,
};

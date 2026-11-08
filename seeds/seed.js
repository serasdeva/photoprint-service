require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { syncDatabase } = require('../config/db');
const { User, Service, GalleryItem, Setting } = require('../models');

async function seed() {
  await syncDatabase();

  const username = process.env.ADMIN_USERNAME || 'admin';
  if (!process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD must be configured in .env before running seed');
  }
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL || 'admin@photoprint.local';

  await User.findOrCreate({
    where: { username },
    defaults: {
      username,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'admin',
    },
  });

  const defaultSettings = [
    ['siteName', 'Фотоистории'],
    ['phone', '+7 (495) 555-11-22'],
    ['email', 'hello@photoprint-service.ru'],
    ['address', 'г. Москва, ул. Тихая, 12'],
    ['workHours', 'Пн–Сб: 09:00–20:00'],
    ['heroTitle', 'Истории, к которым хочется возвращаться'],
    [
      'heroSubtitle',
      'Свадьбы, дни рождения, выпускные и личные съёмки — живые кадры и бережная обработка.',
    ],
    [
      'mapEmbed',
      '<iframe src="https://www.google.com/maps?q=%D0%BF%D0%B3%D1%82.%20%D0%8F%D1%88%D0%BA%D0%B8%D0%BD%D0%BE%2C%20%D0%A1%D1%83%D0%B2%D0%BE%D1%80%D0%BE%D0%B2%D0%BE%208%D0%B0&z=15&output=embed" width="100%" height="100%" frameborder="0" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>',
    ],
  ];

  for (const [key, value] of defaultSettings) {
    await Setting.findOrCreate({
      where: { key },
      defaults: { key, value },
    });
  }
  await Setting.update(
    { value: 'Фотоистории' },
    { where: { key: 'siteName', value: 'PhotoPrint Service' } }
  );
  await Setting.update(
    { value: 'Истории, к которым хочется возвращаться' },
    { where: { key: 'heroTitle', value: 'Печать фото и документов без лишних хлопот' } }
  );
  await Setting.update(
    {
      value: 'Свадьбы, дни рождения, выпускные и личные съёмки — живые кадры и бережная обработка.',
    },
    {
      where: {
        key: 'heroSubtitle',
        value:
          'Помогаем быстро сделать качественные фото, копии, распечатки и оформление документов для дома, офиса и бизнеса.',
      },
    }
  );

  const services = [
    {
      title: 'Свадебная фотосъёмка',
      slug: 'svadebnaya-fotosyomka',
      description:
        'Репортаж со свадьбы, портреты пары и детали дня — формат и продолжительность обсудим заранее.',
      price: 0,
      priceUnit: 'съёмка',
      icon: 'fa-camera',
      order: 1,
      isActive: true,
    },
    {
      title: 'Дни рождения и праздники',
      slug: 'dni-rozhdeniya-i-prazdniki',
      description: 'Живые кадры с гостями, поздравлениями и самыми важными моментами праздника.',
      price: 0,
      priceUnit: 'съёмка',
      icon: 'fa-gift',
      order: 2,
      isActive: true,
    },
    {
      title: 'Выпускные',
      slug: 'vypusknye',
      description: 'Съёмка выпускных вечеров, школьных событий и встреч, которые хочется помнить.',
      price: 0,
      priceUnit: 'съёмка',
      icon: 'fa-graduation-cap',
      order: 3,
      isActive: true,
    },
    {
      title: 'Семейная фотосессия',
      slug: 'semeynaya-fotosessiya',
      description:
        'Прогулка или домашняя съёмка для всей семьи — с естественными эмоциями и без сложных поз.',
      price: 0,
      priceUnit: 'съёмка',
      icon: 'fa-users',
      order: 4,
      isActive: true,
    },
    {
      title: 'Индивидуальный портрет',
      slug: 'individualnyy-portret',
      description:
        'Персональная фотосессия с подготовкой образа, подбором локации и мягким сопровождением.',
      price: 0,
      priceUnit: 'съёмка',
      icon: 'fa-camera',
      order: 5,
      isActive: true,
    },
    {
      title: 'Love story',
      slug: 'love-story',
      description: 'Фотопрогулка для двоих — история о вас, ваших привычках и близости.',
      price: 0,
      priceUnit: 'съёмка',
      icon: 'fa-heart',
      order: 6,
      isActive: true,
    },
  ];

  const legacyServices = [
    ['foto-10x15', 'Фото 10×15'],
    ['pechat-a4-i-postery', 'Печать A4 и постеры'],
    ['kopirovanie-i-skanirovanie', 'Копирование и сканирование'],
    ['oformlenie-dokumentov', 'Оформление документов'],
    ['dizajn-i-nabor-teksta', 'Дизайн и набор текста'],
  ];
  for (const [slug, title] of legacyServices) {
    await Service.update({ isActive: false }, { where: { slug, title } });
  }

  for (const service of services) {
    await Service.findOrCreate({
      where: { slug: service.slug },
      defaults: service,
    });
  }

  await GalleryItem.destroy({
    where: {
      title: [
        'Печать семейных фото',
        'Документальная печать',
        'Сканирование бумаг',
        'Копировальный центр',
      ],
      url: [
        '/gallery-placeholders/sample-1.svg',
        '/gallery-placeholders/sample-2.svg',
        '/gallery-placeholders/sample-3.svg',
        '/gallery-placeholders/sample-4.svg',
        '/uploads/gallery/sample-1.svg',
        '/uploads/gallery/sample-2.svg',
        '/uploads/gallery/sample-3.svg',
        '/uploads/gallery/sample-4.svg',
      ],
    },
  });

  console.log(
    `Seed finished. Admin user created: ${username}. Use the password from ADMIN_PASSWORD in .env.`
  );
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

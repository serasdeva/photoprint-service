require('dotenv').config();
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
    ['siteName', 'PhotoPrint Service'],
    ['phone', '+7 (495) 123-45-67'],
    ['email', 'hello@photoprint.local'],
    ['address', 'пгт. Яшкино, Суворово 8а'],
    ['workHours', 'Пн–Сб: 09:00–20:00'],
    ['heroTitle', 'Печать, копирование и оформление документов'],
    ['heroSubtitle', 'Быстро, качественно и по доступной цене для дома, офиса и бизнеса.'],
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

  const services = [
    {
      title: 'Фото 10x15',
      slug: 'foto-10x15',
      description: 'Печать фотографий 10×15 для документов, подарков и семейных архивов.',
      price: 25,
      priceUnit: 'шт',
      icon: 'fa-camera',
      order: 1,
      isActive: true,
    },
    {
      title: 'Фото A4',
      slug: 'foto-a4',
      description: 'Красочная печать на фотобумаге формата A4.',
      price: 90,
      priceUnit: 'лист',
      icon: 'fa-image',
      order: 2,
      isActive: true,
    },
    {
      title: 'Копирование',
      slug: 'kopirovanie',
      description: 'Черно-белое и цветное копирование документов.',
      price: 10,
      priceUnit: 'лист',
      icon: 'fa-copy',
      order: 3,
      isActive: true,
    },
    {
      title: 'Оформление документов',
      slug: 'oformlenie-dokumentov',
      description: 'Помощь в заполнении и оформлении документов, бланков и заявлений.',
      price: 250,
      priceUnit: 'услуга',
      icon: 'fa-file-signature',
      order: 4,
      isActive: true,
    },
    {
      title: 'Набор текста',
      slug: 'nabor-teksta',
      description: 'Печать и набор текста в Word, PDF, таблицы и отчеты.',
      price: 80,
      priceUnit: 'страница',
      icon: 'fa-keyboard',
      order: 5,
      isActive: true,
    },
  ];

  for (const service of services) {
    await Service.findOrCreate({
      where: { slug: service.slug },
      defaults: service,
    });
  }

  const galleryItems = [
    {
      title: 'Печать семейных фото',
      type: 'image',
      url: '/gallery-placeholders/sample-1.svg',
      category: 'photo',
      description: 'Фотопечать и обработка кадра',
      order: 1,
    },
    {
      title: 'Документальная печать',
      type: 'image',
      url: '/gallery-placeholders/sample-2.svg',
      category: 'print',
      description: 'Печать документов и отчетов',
      order: 2,
    },
    {
      title: 'Сканирование бумаг',
      type: 'image',
      url: '/gallery-placeholders/sample-3.svg',
      category: 'docs',
      description: 'Подготовка и сканирование документов',
      order: 3,
    },
    {
      title: 'Копировальный центр',
      type: 'image',
      url: '/gallery-placeholders/sample-4.svg',
      category: 'print',
      description: 'Рабочий процесс и продуктивность',
      order: 4,
    },
  ];

  for (const item of galleryItems) {
    await GalleryItem.findOrCreate({
      where: { title: item.title },
      defaults: item,
    });

    const sampleNumber = item.url.match(/sample-(\d+)\.svg$/)[1];
    await GalleryItem.update(
      { url: item.url },
      {
        where: {
          title: item.title,
          url: `/uploads/gallery/sample-${sampleNumber}.svg`,
        },
      }
    );
  }

  console.log(
    `Seed finished. Admin user created: ${username}. Use the password from ADMIN_PASSWORD in .env.`
  );
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

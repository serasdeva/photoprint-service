const { test, expect } = require('@playwright/test');

const TOTAL = 15;
const PAGE_SIZE = 12;

test.describe('галерея', () => {
  test('догружает работы и открывает лайтбокс', async ({ page }) => {
    await page.goto('/gallery');

    const items = page.locator('[data-gallery-item]');
    await expect(items).toHaveCount(PAGE_SIZE);
    await expect(page.locator('[data-gallery-status]')).toHaveText(
      `Показано ${PAGE_SIZE} из ${TOTAL}`
    );

    await page.locator('[data-gallery-more]').click();
    await expect(items).toHaveCount(TOTAL);
    await expect(page.locator('[data-gallery-more]')).toBeHidden();

    await items.first().click();
    const lightbox = page.locator('#lightbox');
    await expect(lightbox).toHaveClass(/open/);
    await expect(page.locator('#lightbox-counter')).toHaveText(`1 / ${TOTAL}`);

    // Клавиатура — основной способ листать: проверяем и переход, и закрытие.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#lightbox-counter')).toHaveText(`2 / ${TOTAL}`);

    await page.keyboard.press('Escape');
    await expect(lightbox).not.toHaveClass(/open/);
  });

  test('фильтр по категории перерисовывает сетку', async ({ page }) => {
    await page.goto('/gallery');

    // В сиде 15 работ, по 5 на каждую категорию.
    await page.locator('[data-filter="photo"]').click();
    await expect(page.locator('[data-gallery-item]')).toHaveCount(5);
    await expect(page.locator('[data-gallery-status]')).toHaveText('Показано 5 из 5');
    await expect(page.locator('[data-gallery-more]')).toBeHidden();
  });
});

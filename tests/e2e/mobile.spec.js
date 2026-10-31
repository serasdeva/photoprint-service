const { test, expect } = require('@playwright/test');

test.describe('мобильная навигация', () => {
  // Бургер виден только на узком экране: в десктопном проекте сценарий пропускается.
  test.skip(({ viewport }) => !viewport || viewport.width > 980, 'нужен мобильный вьюпорт');

  test('бургер открывает меню, Escape закрывает', async ({ page }) => {
    await page.goto('/');

    const toggle = page.locator('.burger');
    const nav = page.locator('#site-nav');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toHaveClass(/open/);

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).not.toHaveClass(/open/);
  });
});

const { test, expect } = require('@playwright/test');

test('тема переключается и сохраняется после перезагрузки', async ({ page }) => {
  // Системную тему фиксируем, иначе theme-boot возьмёт prefers-color-scheme раннера.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');

  const toggle = page.locator('[data-theme-toggle]').first();
  await toggle.click();

  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // theme.js подменяет theme-color на фактический фон: сравниваем с текущим токеном,
  // а не с константой — палитра сайта (site.css) переопределяет tokens.css.
  const metaAndBackground = await page.evaluate(() => ({
    meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
    background: getComputedStyle(document.body).getPropertyValue('--bg').trim(),
  }));
  expect(metaAndBackground.meta).toBe(metaAndBackground.background);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

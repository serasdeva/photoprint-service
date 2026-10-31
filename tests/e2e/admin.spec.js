const { test, expect } = require('@playwright/test');

test('вход в админку и живой предпросмотр настроек', async ({ page }) => {
  await page.goto('/admin/login');
  await page.fill('input[name="username"]', 'e2e-admin');
  await page.fill('input[name="password"]', 'E2eAdmin123!');
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('body')).toContainText('Панель управления');

  await page.goto('/admin/settings');
  await page.fill('#s-heroTitle', 'E2E заголовок');
  await expect(page.locator('[data-settings-preview-title]')).toHaveText('E2E заголовок');

  // Сохранение идёт обычным POST с CSRF-токеном из формы.
  await page.click('form[action="/admin/settings"] button[type="submit"]');
  await expect(page.locator('.toast-success')).toContainText('Настройки сохранены');
});

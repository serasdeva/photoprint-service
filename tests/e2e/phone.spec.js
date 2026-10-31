const { test, expect } = require('@playwright/test');

test('маска приводит номер к формату +7 (900) 555-35-35', async ({ page }) => {
  await page.goto('/');

  const input = page.locator('[data-phone-mask]').first();
  await input.fill('9005553535');
  await expect(input).toHaveValue('+7 (900) 555-35-35');

  // Восьмёрка в начале — тот же номер: код страны отбрасывается, а не превращается в «+7 (005)…».
  await input.fill('89005553535');
  await expect(input).toHaveValue('+7 (900) 555-35-35');
});

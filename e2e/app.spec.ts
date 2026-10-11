import { expect, test } from '@playwright/test';

test('loads the app shell and generates a mission from the default Berlin area', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /your daily dose/i })).toBeVisible();
  await expect(page.getByText(/your patch of berlin/i)).toBeVisible();

  const startButton = page.getByRole('button', { name: /find my little adventure/i });
  await expect(startButton).toBeVisible();
  await startButton.click();

  await expect(page.getByText(/a green little detour/i)).toBeVisible();
  await expect(page.getByText(/keep an eye out for/i)).toBeVisible();
  await expect(page.getByText(/handcrafted mission · ai not used/i)).toBeVisible();
  await expect(page.locator('.briefing-copy')).toBeVisible();
  await expect(page.locator('.generated-mission')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /try optional ai mission/i })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByRole('button', { name: /try optional ai mission/i }).click();
  await expect(page.getByRole('status').getByText(/WebGPU is not available/i)).toBeVisible();
  await expect(page.getByText(/handcrafted mission remains · ai experiment unavailable/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /field notes/i }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByText(/SmolLM2-360M-Instruct · Apache-2\.0/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /download model on this device/i })).toBeVisible();
});

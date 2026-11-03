const { test, expect, crackCookie, crackAnother, openHistory } = require('./fixtures');

const historyCount = page => page.evaluate(() => fortuneApp.messageManager.fortuneHistory.length);

test.beforeEach(async ({ page }) => {
    await page.goto('/');
});

test('a visible hint explains the first step, in words that suit any device', async ({ page }) => {
    const hint = page.locator('#cookieHint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Crack the cookie to reveal your fortune');
    await crackCookie(page);
    await expect(hint).toBeHidden();
});

test('"Crack another cookie" appears after revealing and has keyboard focus', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Crack another cookie' });
    await expect(button).toBeHidden();
    await crackCookie(page);
    await expect(button).toBeVisible();
    await expect(button).toBeFocused();
});

test('one press reveals a new fortune and records it', async ({ page }) => {
    await crackCookie(page);
    await crackAnother(page);
    await expect(page.locator('#cookieStage')).toHaveClass(/cracked/);
    expect(await historyCount(page)).toBe(2);
    await openHistory(page);
    await expect(page.locator('.history-item')).toHaveCount(2);
});

test('repeated Enter keeps cracking cookies without leaving the button', async ({ page }) => {
    await crackCookie(page);
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Enter');
        // Wait on the count: two consecutive fortunes can have the same text
        await expect.poll(() => historyCount(page)).toBe(i + 2);
        await expect(page.locator('#crackAnotherBtn')).toBeFocused();
    }
    expect(await historyCount(page)).toBe(4);
});

test('a double click cracks only one more cookie', async ({ page }) => {
    await crackCookie(page);
    await page.locator('#crackAnotherBtn').dblclick();
    await page.waitForTimeout(1000);
    expect(await historyCount(page)).toBe(2);
});

test('the slip no longer has a close button; Escape brings back the cookie and hint', async ({ page }) => {
    await crackCookie(page);
    await expect(page.getByRole('button', { name: /Close fortune/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#cookieHint')).toBeVisible();
    await expect(page.locator('#crackAnotherBtn')).toBeHidden();
});

test('Escape during the re-crack cancels it', async ({ page }) => {
    await crackCookie(page);
    await page.locator('#crackAnotherBtn').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await expect(page.locator('#cookieStage')).not.toHaveClass(/cracked/);
    expect(await historyCount(page)).toBe(1);
});

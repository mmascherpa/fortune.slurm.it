const { test, expect, crackCookie, closeFortune, openHistory } = require('./fixtures');

test.describe('cracking a cookie', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('shows a fortune with six lucky numbers', async ({ page }) => {
        await crackCookie(page);
        await expect(page.locator('#fortuneSlip')).toBeVisible();
        const numbers = (await page.locator('#luckyNumbers').textContent()).split(',').map(Number);
        expect(numbers).toHaveLength(6);
        expect(new Set(numbers).size).toBe(6);
        numbers.forEach(n => expect(n).toBeGreaterThanOrEqual(1));
    });

    test('records each fortune in history and counts it', async ({ page }) => {
        await crackCookie(page);
        const first = await page.locator('#fortuneText').textContent();
        await closeFortune(page);
        await crackCookie(page);
        const second = await page.locator('#fortuneText').textContent();

        await openHistory(page);
        await expect(page.locator('.history-fortune-text')).toHaveText([second, first]);
        await expect(page.locator('#fortuneCounter')).toHaveText('(2 collected)');
    });

    test('closing the fortune brings the cookie back', async ({ page }) => {
        await crackCookie(page);
        await closeFortune(page);
        await expect(page.locator('#cookieStage')).not.toHaveClass(/cracked/);
        await expect(page.locator('#cookieContainer')).toBeFocused();
    });

    test('Escape also closes the fortune', async ({ page }) => {
        await crackCookie(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#cookieStage')).not.toHaveClass(/cracked/);
    });

    test('history survives a reload', async ({ page }) => {
        await crackCookie(page);
        const text = await page.locator('#fortuneText').textContent();
        await page.reload();
        await openHistory(page);
        await expect(page.locator('.history-fortune-text').first()).toHaveText(text);
    });
});

test.describe('without the advice API', () => {
    test.use({ api: 'offline' });

    test('still serves built-in fortunes and shows the offline status', async ({ page }) => {
        await page.goto('/');
        await crackCookie(page);
        await expect(page.locator('#fortuneText')).toHaveText(/\S/);
        await expect(page.locator('#status-indicator')).toHaveAttribute('aria-label', /Connection issues|Offline/);
    });
});

test('every file the page references is served', async ({ page, request }) => {
    await page.goto('/');
    const urls = await page.evaluate(() => Array.from(
        document.querySelectorAll('link[href], script[src], img[src]'),
        el => new URL(el.getAttribute('href') || el.getAttribute('src'), location.href)
    ).filter(url => url.origin === location.origin).map(url => url.pathname));
    expect(urls.length).toBeGreaterThan(0);
    for (const path of urls) {
        const response = await request.get(path);
        expect(response.status(), `${path} should be published`).toBe(200);
    }
});

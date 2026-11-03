const { test, expect, crackCookie, crackAnother, openHistory, waitForAnimations } = require('./fixtures');

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
        await crackAnother(page);
        const second = await page.locator('#fortuneText').textContent();

        await openHistory(page);
        await expect(page.locator('.history-fortune-text')).toHaveText([second, first]);
        await expect(page.locator('#fortuneCounter')).toHaveText('2 cookies cracked so far');
    });

    test('Escape puts the fortune away and brings the cookie back', async ({ page }) => {
        await crackCookie(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#cookieStage')).not.toHaveClass(/cracked/);
        await expect(page.locator('#cookieContainer')).toBeFocused();
    });

    test('history survives a reload', async ({ page }) => {
        await crackCookie(page);
        const text = await page.locator('#fortuneText').textContent();
        await page.reload();
        await openHistory(page);
        await expect(page.locator('.history-fortune-text').first()).toHaveText(text);
    });
});

test.describe('the fortune slip', () => {
    const LONG_FORTUNE = 'Remember that spiders are more afraid of you than you are of them, and that the best '
        + 'way to deal with fear is to understand it, face it calmly, and then go and make yourself a '
        + 'really good cup of tea.';

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await crackCookie(page);
        await waitForAnimations(page);
    });

    test('the message is the most prominent text, the lucky numbers are quieter', async ({ page }) => {
        const style = selector => page.locator(selector).evaluate(el => {
            const s = getComputedStyle(el);
            return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), italic: s.fontStyle === 'italic' };
        });
        const message = await style('#fortuneText');
        const numbers = await style('#luckyNumbers');
        expect(message.italic).toBe(false);
        expect(message.size).toBeGreaterThanOrEqual(17);
        expect(numbers.size).toBeLessThan(message.size);
        expect(numbers.weight).toBeLessThanOrEqual(message.weight);
    });

    test('Copy and Save sit together on the slip and are at least 44px tall', async ({ page }) => {
        const copy = await page.getByRole('button', { name: 'Copy', exact: true }).boundingBox();
        const save = await page.getByRole('button', { name: 'Save favourite' }).boundingBox();
        const slip = await page.locator('#fortuneSlip').boundingBox();
        for (const box of [copy, save]) {
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.y).toBeGreaterThanOrEqual(slip.y);
            expect(box.y + box.height).toBeLessThanOrEqual(slip.y + slip.height);
        }
    });

    test('Copy confirms on the button, then returns to its label', async ({ page }) => {
        const copy = page.locator('#copyBtn');
        await copy.click();
        await expect(copy).toHaveText('Copied');
        await copy.click();
        await expect(copy).toHaveText('Copy', { timeout: 4000 });
    });

    test('a long fortune grows the slip instead of covering the next button', async ({ page }) => {
        await page.locator('#fortuneText').evaluate((el, text) => { el.textContent = text; }, LONG_FORTUNE);
        const slip = await page.locator('#fortuneSlip').boundingBox();
        const next = await page.locator('#crackAnotherBtn').boundingBox();
        expect(slip.y + slip.height).toBeLessThanOrEqual(next.y);
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

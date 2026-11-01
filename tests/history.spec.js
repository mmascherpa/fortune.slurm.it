const { test, expect, makeHistoryItem, crackCookie, closeFortune, openHistory } = require('./fixtures');

// 30 fortunes, the 5 oldest of which are favourites
const THIRTY_WITH_FIVE_FAVOURITES = Array.from({ length: 30 }, (_, i) => makeHistoryItem(i, i >= 25));

const historyTexts = page => page.locator('.history-item .history-fortune-text');

test.describe('history panel', () => {
    test.use({ seed: { history: THIRTY_WITH_FIVE_FAVOURITES } });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await openHistory(page);
    });

    test('keeps every favourite beyond the 20-item limit', async ({ page }) => {
        await expect(historyTexts(page)).toHaveCount(25);
        await page.locator('#filterToggle').click();
        await expect(historyTexts(page)).toHaveText(['Fortune 25', 'Fortune 26', 'Fortune 27', 'Fortune 28', 'Fortune 29']);
    });

    test('favourites survive new fortunes pushing out old ones', async ({ page }) => {
        await page.locator('#historyClose').click();
        for (let i = 0; i < 22; i++) {
            await crackCookie(page);
            await closeFortune(page);
        }
        await openHistory(page);
        await page.locator('#filterToggle').click();
        await expect(historyTexts(page)).toHaveCount(5);
    });

    test('search filters and highlights matches', async ({ page }) => {
        await page.locator('#historySearch').fill('Fortune 2');
        // Fortune 2 and the favourites 25-29 (20-24 were trimmed as the oldest non-favourites)
        await expect(historyTexts(page)).toHaveCount(6);
        await expect(page.locator('.search-highlight').first()).toHaveText('Fortune 2');
    });

    test('deleting with the favourites filter on removes the chosen card', async ({ page }) => {
        await page.locator('#filterToggle').click();
        await page.locator('.history-delete-btn').nth(2).click();
        await expect(historyTexts(page)).toHaveText(['Fortune 25', 'Fortune 26', 'Fortune 28', 'Fortune 29']);
    });

    test('deleting with a search active removes the chosen card', async ({ page }) => {
        await page.locator('#historySearch').fill('Fortune 1');
        const last = historyTexts(page).last();
        const target = await last.textContent();
        await page.locator('.history-delete-btn').last().click();
        await expect(historyTexts(page).filter({ hasText: new RegExp(`^${target}$`) })).toHaveCount(0);
    });

    test('first Escape clears the search, second closes the panel', async ({ page }) => {
        await page.locator('#historySearch').fill('Fortune');
        await page.keyboard.press('Escape');
        await expect(page.locator('#historySearch')).toHaveValue('');
        await expect(page.locator('#historyPanel')).toHaveAttribute('open');
        await page.keyboard.press('Escape');
        await expect(page.locator('#historyPanel')).not.toHaveAttribute('open');
    });
});

test.describe('untrusted fortune text', () => {
    test.use({
        seed: { history: [makeHistoryItem(0, false, { message: '<img src=x onerror="window.__pwned=1"> Tom & Jerry' })] }
    });

    test('is shown as text and never executed', async ({ page }) => {
        await page.goto('/');
        await openHistory(page);
        await expect(historyTexts(page)).toHaveText('<img src=x onerror="window.__pwned=1"> Tom & Jerry');
        await page.locator('#historySearch').fill('tom');
        await expect(page.locator('.search-highlight')).toHaveText('Tom');
        await expect(page.locator('#historyList img')).toHaveCount(0);
        expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    });
});

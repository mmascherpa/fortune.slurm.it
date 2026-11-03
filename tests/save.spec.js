const { test, expect, makeHistoryItem, crackCookie, openHistory } = require('./fixtures');

const saveButton = page => page.getByRole('button', { name: 'Save favourite' });
const historyButton = page => page.locator('#historyToggle');
const storedHistory = page => page.evaluate(() => JSON.parse(localStorage.getItem('fortune_history')));

test.describe('saving from the fortune slip', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await crackCookie(page);
    });

    test('saves the shown fortune as a favourite, with feedback', async ({ page }) => {
        await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'false');
        await saveButton(page).click();
        await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#toast')).toHaveText('Saved to favourites');
        await expect(page.locator('#toast')).toBeVisible();

        const text = await page.locator('#fortuneText').textContent();
        const history = await storedHistory(page);
        expect(history[0]).toMatchObject({ message: text, isFavorite: true });
    });

    test('pressing again removes it', async ({ page }) => {
        await saveButton(page).click();
        await saveButton(page).click();
        await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#toast')).toHaveText('Removed from favourites');
        expect((await storedHistory(page))[0].isFavorite).toBe(false);
    });

    test('the message goes away by itself', async ({ page }) => {
        await saveButton(page).click();
        await expect(page.locator('#toast')).toHaveClass(/visible/);
        await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 4000 });
        await expect(page.locator('#toast')).toHaveText('');
    });

    test('the saved fortune shows as a favourite in history', async ({ page }) => {
        await saveButton(page).click();
        await page.keyboard.press('Escape');
        await openHistory(page);
        await page.locator('#filterToggle').click();
        await expect(page.locator('.history-item')).toHaveCount(1);
        await expect(page.locator('.history-favorite-btn')).toHaveAttribute('aria-pressed', 'true');
    });

    test('unstarring in history updates the slip and keeps focus on the star', async ({ page }) => {
        await saveButton(page).click();
        await openHistory(page);
        const star = page.locator('.history-favorite-btn').first();
        await star.click();
        await expect(page.locator('.history-favorite-btn').first()).toBeFocused();
        await expect(page.locator('.history-favorite-btn').first()).toHaveAttribute('aria-pressed', 'false');
        // The drawer has its own message area: the page behind it is inert
        await expect(page.locator('#historyToast')).toHaveText('Removed from favourites');
        await page.keyboard.press('Escape');
        await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'false');
    });

    test('saving after the fortune was deleted from history explains why nothing happened', async ({ page }) => {
        await openHistory(page);
        await page.locator('.history-delete-btn').first().click();
        await expect(page.locator('.history-item')).toHaveCount(0);
        await page.locator('#historyClose').click();
        await saveButton(page).click();
        await expect(page.locator('#toast')).toHaveText('This fortune was deleted from your history');
        await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'false');
    });

    test('each new fortune starts unsaved', async ({ page }) => {
        await saveButton(page).click();
        await page.keyboard.press('Escape');
        await crackCookie(page);
        await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'false');
    });
});

test.describe('History button', () => {
    test('is labelled and shows how many fortunes are in history', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: 'History 0 fortunes' })).toBeVisible();
        await crackCookie(page);
        await expect(page.getByRole('button', { name: 'History 1 fortunes' })).toBeVisible();
        await expect(historyButton(page).locator('#historyCount')).toHaveText('1');
        // The word is visible on wide screens; small screens show the icon with a count badge
        const label = historyButton(page).locator('.history-toggle-label');
        if (page.viewportSize().width > 768) {
            await expect(label).toBeVisible();
        } else {
            expect(await label.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
        }
    });

    for (const width of [360, 412, 600, 768, 1024]) {
        test(`does not overlap the page title at ${width}px wide`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await page.goto('/');
            await expect(page.locator('.title')).toBeVisible();
            await page.locator('#historyCount').evaluate(el => { el.textContent = '99'; });
            const button = await historyButton(page).boundingBox();
            const badge = await page.locator('.history-count').boundingBox();
            const left = Math.min(button.x, badge.x);
            const bottom = Math.max(button.y + button.height, badge.y + badge.height);
            const lines = await page.locator('.title').evaluate(el => {
                const range = document.createRange();
                range.selectNodeContents(el);
                return Array.from(range.getClientRects()).map(r => ({ top: r.top, bottom: r.bottom, right: r.right }));
            });
            const overlapping = lines.filter(line => line.top < bottom && line.bottom > button.y && line.right > left);
            expect(overlapping).toEqual([]);
        });
    }
});

test.describe('counts', () => {
    test.use({ seed: { history: [makeHistoryItem(0), makeHistoryItem(1), makeHistoryItem(2)] } });

    test('deleting updates the History count but not the cookies-cracked total', async ({ page }) => {
        await page.goto('/');
        await crackCookie(page);
        await page.keyboard.press('Escape');
        await expect(historyButton(page).locator('#historyCount')).toHaveText('4');
        await openHistory(page);
        await expect(page.locator('#fortuneCounter')).toHaveText('1 cookie cracked so far');
        await page.locator('.history-delete-btn').first().click();
        await expect(page.locator('.history-item')).toHaveCount(3);
        await expect(historyButton(page).locator('#historyCount')).toHaveText('3');
        await expect(page.locator('#fortuneCounter')).toHaveText('1 cookie cracked so far');
    });

    test('fortunes saved before this change get a permanent id and still work', async ({ page }) => {
        await page.goto('/');
        await openHistory(page);
        const uids = await page.locator('.history-item').evaluateAll(els => els.map(el => el.dataset.uid));
        expect(uids).toHaveLength(3);
        expect(new Set(uids).size).toBe(3);
        uids.forEach(uid => expect(uid).toBeTruthy());
        await page.locator('.history-favorite-btn').nth(1).click();
        await expect(page.locator('.history-favorite-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
        const stored = await storedHistory(page);
        expect(stored.map(item => item.isFavorite)).toEqual([false, true, false]);
        expect(stored.every(item => item.uid)).toBe(true);
    });
});

test.describe('British spelling', () => {
    test('uses "favourite" throughout the interface', async ({ page }) => {
        await page.goto('/');
        await crackCookie(page);
        await page.keyboard.press('Escape');
        await openHistory(page);
        const visibleText = await page.evaluate(() => document.body.innerText);
        expect(visibleText).not.toMatch(/favorite/i);
        await expect(page.locator('#filterToggle')).toHaveText('Favourites only');
    });
});

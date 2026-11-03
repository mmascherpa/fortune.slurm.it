const { test, expect, makeHistoryItem, crackCookie, openHistory } = require('./fixtures');

const FOUR = [makeHistoryItem(0), makeHistoryItem(1, true), makeHistoryItem(2), makeHistoryItem(3)];
const historyTexts = page => page.locator('.history-item .history-fortune-text');
const undoButton = page => page.getByRole('button', { name: 'Undo' });
const storedMessages = page => page.evaluate(() =>
    JSON.parse(localStorage.getItem('fortune_history')).map(item => item.message));

test.describe('deleting with undo', () => {
    test.use({ seed: { history: FOUR } });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await openHistory(page);
    });

    test('deletes straight away and offers Undo', async ({ page }) => {
        await page.locator('.history-delete-btn').nth(1).click();
        await expect(historyTexts(page)).toHaveText(['Fortune 0', 'Fortune 2', 'Fortune 3']);
        await expect(page.locator('#historyToast')).toContainText('Fortune deleted');
        await expect(undoButton(page)).toBeVisible();
        await expect(page.locator('#historyCount')).toHaveText('3');
        expect(await storedMessages(page)).toEqual(['Fortune 0', 'Fortune 2', 'Fortune 3']);
    });

    test('Undo puts it back in the same place, still a favourite', async ({ page }) => {
        await page.locator('.history-delete-btn').nth(1).click();
        await undoButton(page).click();
        await expect(historyTexts(page)).toHaveText(['Fortune 0', 'Fortune 1', 'Fortune 2', 'Fortune 3']);
        await expect(page.locator('.history-favorite-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#historyToast')).toContainText('Fortune restored');
        await expect(page.locator('#historyCount')).toHaveText('4');
        // Focus lands on the restored card
        await expect(page.locator('.history-delete-btn').nth(1)).toBeFocused();
        expect(await storedMessages(page)).toEqual(['Fortune 0', 'Fortune 1', 'Fortune 2', 'Fortune 3']);
    });

    test('the offer expires after about five seconds and the deletion stays', async ({ page }) => {
        await page.locator('.history-delete-btn').first().click();
        // Move the pointer away so hovering doesn't hold the message open
        await page.mouse.move(5, 5);
        await expect(undoButton(page)).toBeVisible();
        await expect(undoButton(page)).toHaveCount(0, { timeout: 7000 });
        await page.reload();
        expect(await storedMessages(page)).toEqual(['Fortune 1', 'Fortune 2', 'Fortune 3']);
    });

    test('keyboard: Undo gets focus and stays available while focused', async ({ page }) => {
        await page.locator('.history-delete-btn').first().focus();
        await page.keyboard.press('Enter');
        await expect(undoButton(page)).toBeFocused();
        await page.waitForTimeout(6000);
        await expect(undoButton(page)).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(historyTexts(page)).toHaveCount(4);
        await expect(page.locator('.history-delete-btn').first()).toBeFocused();
    });

    test('keyboard: leaving Undo restarts the countdown', async ({ page }) => {
        await page.locator('.history-delete-btn').first().focus();
        await page.keyboard.press('Enter');
        await expect(undoButton(page)).toBeFocused();
        await page.locator('#historySearch').focus();
        await expect(undoButton(page)).toHaveCount(0, { timeout: 7000 });
    });

    test('mouse: deleting does not move focus to Undo', async ({ page }) => {
        await page.locator('.history-delete-btn').first().click();
        await expect(undoButton(page)).toBeVisible();
        await expect(undoButton(page)).not.toBeFocused();
    });

    test('a second delete replaces the first offer; only the latest can be undone', async ({ page }) => {
        await page.locator('.history-delete-btn').first().click();
        await expect(historyTexts(page)).toHaveCount(3);
        await page.locator('.history-delete-btn').first().click();
        await expect(historyTexts(page)).toHaveCount(2);
        await expect(undoButton(page)).toHaveCount(1);
        await undoButton(page).click();
        await expect(historyTexts(page)).toHaveText(['Fortune 1', 'Fortune 2', 'Fortune 3']);
    });

    test('closing the drawer keeps the deletion', async ({ page }) => {
        await page.locator('.history-delete-btn').first().click();
        await page.keyboard.press('Escape');
        await expect(page.locator('#historyPanel')).not.toHaveAttribute('open');
        await openHistory(page);
        await expect(undoButton(page)).toHaveCount(0);
        await expect(historyTexts(page)).toHaveCount(3);
    });

    test('a double click deletes only one fortune', async ({ page }) => {
        await page.locator('.history-delete-btn').first().dblclick();
        await page.waitForTimeout(600);
        await expect(historyTexts(page)).toHaveCount(3);
    });

    test('there is no confirmation dialog any more', async ({ page }) => {
        await page.locator('.history-delete-btn').first().click();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
    });
});

test('undoing the delete of the fortune on screen restores its saved state on the slip', async ({ page }) => {
    await page.goto('/');
    await crackCookie(page);
    await page.getByRole('button', { name: 'Save favourite' }).click();
    await openHistory(page);
    await page.locator('.history-delete-btn').first().click();
    await undoButton(page).click();
    await page.locator('#historyClose').click();
    await expect(page.getByRole('button', { name: 'Save favourite' })).toHaveAttribute('aria-pressed', 'true');
});

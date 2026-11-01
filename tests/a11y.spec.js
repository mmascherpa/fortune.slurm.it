const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, makeHistoryItem, crackCookie, openHistory } = require('./fixtures');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function expectNoViolations(page) {
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const summary = results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
    expect(summary).toEqual([]);
}

// Names in Chromium's own accessibility tree: what a screen reader receives. Playwright's
// ariaSnapshot() is an approximation that does not apply `inert`, so it can't be used here.
async function accessibleNames(page) {
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    await cdp.detach();
    return nodes.filter(n => !n.ignored && n.name && n.name.value).map(n => n.name.value).join('\n');
}

// Ids and names of everything Tab can reach, in order, starting from the top of the page
async function tabStops(page, count) {
    await page.locator('body').focus();
    const stops = [];
    for (let i = 0; i < count; i++) {
        await page.keyboard.press('Tab');
        stops.push(await page.evaluate(() => {
            const el = document.activeElement;
            return el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30);
        }));
    }
    return stops;
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Let the entrance animation finish so checks see the settled page
    await expect(page.locator('#cookie')).toHaveClass(/visible/);
});

test.describe('automated accessibility check (axe-core)', () => {
    test('opening screen', async ({ page }) => {
        await expectNoViolations(page);
    });

    test('fortune revealed', async ({ page }) => {
        await crackCookie(page);
        await expect(page.locator('#fortuneSlip')).toBeVisible();
        await expectNoViolations(page);
    });

    test('history open, empty', async ({ page }) => {
        await openHistory(page);
        await expectNoViolations(page);
    });

    test('history open, with fortunes', async ({ page }) => {
        await crackCookie(page);
        await page.keyboard.press('Escape');
        await openHistory(page);
        await expect(page.locator('.history-item')).toHaveCount(1);
        await expectNoViolations(page);
    });

    test('delete confirmation', async ({ page }) => {
        await crackCookie(page);
        await page.keyboard.press('Escape');
        await openHistory(page);
        await page.locator('.history-delete-btn').click();
        await expect(page.locator('.confirmation-dialog')).toBeVisible();
        await expectNoViolations(page);
    });
});

test.describe('fortune cookie semantics', () => {
    test('the cookie is a plain button, not a toggle', async ({ page }) => {
        const cookie = page.getByRole('button', { name: 'Crack the fortune cookie' });
        await expect(cookie).toBeVisible();
        await expect(cookie).not.toHaveAttribute('aria-pressed');
        await expect(page.locator('[role="application"]')).toHaveCount(0);
    });

    test('Enter and Space crack the cookie', async ({ page }) => {
        await page.locator('#cookieContainer').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#cookieStage')).toHaveClass(/cracked/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#cookieContainer')).toBeFocused();
        await page.keyboard.press(' ');
        await expect(page.locator('#cookieStage')).toHaveClass(/cracked/);
    });

    test('the hidden slip is not reachable before cracking', async ({ page }) => {
        const stops = await tabStops(page, 6);
        expect(stops).not.toContain('copyBtn');
        expect(stops).not.toContain('closeBtn');
        expect(await accessibleNames(page)).not.toContain('Copy fortune');
    });

    test('revealing a fortune announces it and moves focus to the slip', async ({ page }) => {
        await crackCookie(page);
        const text = await page.locator('#fortuneText').textContent();
        await expect(page.getByRole('status').filter({ hasText: 'Your fortune' })).toContainText(text);
        await expect(page.locator('#closeBtn')).toBeFocused();
        // The faded-out cookie is no longer a tab stop
        await expect(page.locator('#cookieContainer')).toHaveJSProperty('inert', true);
    });
});

test.describe('history drawer', () => {
    test('closed drawer is hidden from keyboard and screen readers', async ({ page }) => {
        const stops = await tabStops(page, 6);
        expect(stops).not.toContain('historyClose');
        expect(stops).not.toContain('historySearch');
        expect(stops).not.toContain('filterToggle');
        expect(await accessibleNames(page)).not.toContain('Search fortunes');
    });

    test('open drawer is a modal dialog and the page behind is inert', async ({ page }) => {
        await openHistory(page);
        const dialog = page.getByRole('dialog', { name: /Fortune History/ });
        await expect(dialog).toBeVisible();
        // Everything outside the dialog leaves the accessibility tree while it is open
        const tree = await accessibleNames(page);
        expect(tree).not.toContain('Crack the fortune cookie');
        expect(tree).not.toContain('Digital Fortune Cookie');
        // Tab stays inside the dialog
        for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() =>
                document.activeElement === document.body || !!document.activeElement.closest('#historyPanel'));
            expect(inside).toBe(true);
        }
    });

    test('Escape closes it and returns focus to the history button', async ({ page }) => {
        await openHistory(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#historyPanel')).not.toHaveAttribute('open');
        await expect(page.locator('#historyToggle')).toBeFocused();
        await expect(page.locator('#historyToggle')).toHaveAttribute('aria-expanded', 'false');
    });

    test('clicking the dimmed background closes it', async ({ page }) => {
        await openHistory(page);
        const viewport = page.viewportSize();
        // Desktop: left of the 400px sheet. Mobile: the sheet is full width, so skip.
        test.skip(viewport.width <= 768, 'drawer covers the full width on small screens');
        await page.mouse.click(20, viewport.height / 2);
        await expect(page.locator('#historyPanel')).not.toHaveAttribute('open');
        await expect(page.locator('#historyToggle')).toBeFocused();
    });

    test('Escape with a revealed fortune closes only the drawer', async ({ page }) => {
        await crackCookie(page);
        await page.locator('#historyToggle').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('#historyPanel')).not.toHaveAttribute('open');
        await expect(page.locator('#cookieStage')).toHaveClass(/cracked/);
    });

    test('favourites filter keeps a constant label and reports its state', async ({ page }) => {
        await openHistory(page);
        const filter = page.getByRole('button', { name: 'Favorites Only' });
        await expect(filter).toHaveAttribute('aria-pressed', 'false');
        await filter.click();
        await expect(filter).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('history drawer with fortunes', () => {
    test.use({ seed: { history: [makeHistoryItem(0), makeHistoryItem(1)] } });

    test('fortunes are a real list', async ({ page }) => {
        await openHistory(page);
        await expect(page.getByRole('list', { name: /Fortune History/ }).getByRole('listitem')).toHaveCount(2);
    });

    test('cancelling a delete returns focus to the delete button', async ({ page }) => {
        await openHistory(page);
        const deleteButton = page.locator('.history-delete-btn').first();
        await deleteButton.click();
        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(deleteButton).toBeFocused();
        await expect(page.locator('#historyPanel')).toHaveAttribute('open');
    });
});

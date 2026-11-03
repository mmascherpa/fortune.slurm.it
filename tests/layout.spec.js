// Layout on small and short screens: nothing clipped, nothing too small to tap
const { test, expect, crackCookie, openHistory, waitForAnimations } = require('./fixtures');

const LONG_FORTUNE = 'Remember that spiders are more afraid of you than you are of them, and that the best '
    + 'way to deal with fear is to understand it, face it calmly, and then go and make yourself a '
    + 'really good cup of tea.';

const lineCount = locator => locator.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set(Array.from(range.getClientRects()).map(r => Math.round(r.top))).size;
});

// Everything Tab can reach in the given scope, with its size
const targetSizes = (page, scope) => page.locator(scope).evaluate(root =>
    Array.from(root.querySelectorAll('button, a[href], input'))
        .filter(el => el.offsetParent !== null && !el.closest('[inert]') && !el.classList.contains('sr-only'))
        .map(el => {
            const r = el.getBoundingClientRect();
            return { name: el.id || el.className || el.textContent.trim(), width: Math.round(r.width), height: Math.round(r.height) };
        }));

const SCREENS = [
    { name: 'small phone', width: 320, height: 568 },
    { name: 'phone', width: 390, height: 844 },
    { name: 'phone in landscape', width: 844, height: 390 },
    { name: 'small phone in landscape', width: 568, height: 320 }
];

for (const screen of SCREENS) {
    test.describe(`${screen.name} (${screen.width}×${screen.height})`, () => {
        test.use({ viewport: { width: screen.width, height: screen.height } });

        test('the title takes at most two lines and starts on screen', async ({ page }) => {
            await page.goto('/');
            const title = page.locator('.title');
            await expect(title).toBeVisible();
            // Measure the settled layout: the title fades in from 20px higher
            await waitForAnimations(page);
            expect(await lineCount(title)).toBeLessThanOrEqual(2);
            expect((await title.boundingBox()).y).toBeGreaterThanOrEqual(0);
        });

        test('a long fortune can be read in full and the next button reached', async ({ page }) => {
            await page.goto('/');
            await crackCookie(page);
            await page.locator('#fortuneText').evaluate((el, text) => { el.textContent = text; }, LONG_FORTUNE);
            await waitForAnimations(page);
            // Nothing is pushed above the top of the page, where it could not be scrolled to
            const slip = await page.locator('#fortuneSlip').boundingBox();
            expect(slip.y).toBeGreaterThanOrEqual(0);
            const next = page.locator('#crackAnotherBtn');
            await next.scrollIntoViewIfNeeded();
            await expect(next).toBeInViewport({ ratio: 1 });
            const scrollable = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
            expect(scrollable, 'no sideways scrolling').toBe(true);
        });
    });
}

test.describe('touch targets are at least 44px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('on the page, with a fortune showing', async ({ page }) => {
        await page.goto('/');
        await crackCookie(page);
        await waitForAnimations(page);
        const small = (await targetSizes(page, 'body'))
            .filter(t => t.name !== 'api-credit' && (t.width < 44 || t.height < 44));
        expect(small).toEqual([]);
        // The credit link stays visually small; its tappable area is extended to 44px
        const creditHitArea = await page.locator('.api-credit').evaluate(el => {
            const link = el.getBoundingClientRect();
            const after = getComputedStyle(el, '::after');
            return link.height - parseFloat(after.top) - parseFloat(after.bottom);
        });
        expect(creditHitArea).toBeGreaterThanOrEqual(44);
    });

    test('in the history drawer', async ({ page }) => {
        await page.goto('/');
        await crackCookie(page);
        await page.keyboard.press('Escape');
        await openHistory(page);
        await waitForAnimations(page);
        const small = (await targetSizes(page, '#historyPanel')).filter(t => t.width < 44 || t.height < 44);
        expect(small).toEqual([]);
    });
});

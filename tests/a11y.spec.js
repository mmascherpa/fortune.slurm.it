const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, crackCookie, openHistory } = require('./fixtures');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

// Violations present on main when this check was added (some only show on one viewport).
// Anything not listed fails the test. Remove an entry in the change that fixes it.
const KNOWN_VIOLATIONS = {
    initial: ['aria-hidden-focus', 'aria-required-children', 'nested-interactive'],
    cracked: ['aria-allowed-role', 'aria-required-children', 'label-content-name-mismatch', 'nested-interactive'],
    historyOpen: ['aria-hidden-focus', 'aria-required-children', 'label-content-name-mismatch', 'nested-interactive']
};

function expectOnlyKnown(actual, known) {
    expect(actual.filter(id => !known.includes(id)), 'new accessibility violations').toEqual([]);
}

async function violationIds(page) {
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    return results.violations.map(v => v.id).sort();
}

test.describe('automated accessibility check (axe-core)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Let the entrance animation finish so axe sees the settled page
        await expect(page.locator('#cookie')).toHaveClass(/visible/);
    });

    test('opening screen', async ({ page }) => {
        expectOnlyKnown(await violationIds(page), KNOWN_VIOLATIONS.initial);
    });

    test('fortune revealed', async ({ page }) => {
        await crackCookie(page);
        await expect(page.locator('#fortuneSlip')).toBeVisible();
        expectOnlyKnown(await violationIds(page), KNOWN_VIOLATIONS.cracked);
    });

    test('history open', async ({ page }) => {
        await openHistory(page);
        expectOnlyKnown(await violationIds(page), KNOWN_VIOLATIONS.historyOpen);
    });
});

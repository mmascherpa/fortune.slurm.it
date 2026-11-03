const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, crackCookie, openHistory, waitForAnimations } = require('./fixtures');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

// Violations present on main when this check was added (some only show on one viewport).
// Anything not listed fails the test. Remove an entry in the change that fixes it.
const KNOWN_VIOLATIONS = {
    initial: ['aria-hidden-focus', 'aria-required-children', 'nested-interactive'],
    cracked: ['aria-allowed-role', 'aria-required-children', 'label-content-name-mismatch', 'nested-interactive'],
    historyOpen: ['aria-hidden-focus', 'aria-required-children', 'label-content-name-mismatch', 'nested-interactive']
};

// Failures name the rule and the offending elements, e.g. "target-size: #copyBtn"
function expectOnlyKnown(violations, known) {
    const unexpected = violations
        .filter(v => !known.includes(v.id))
        .map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
    expect(unexpected, 'new accessibility violations').toEqual([]);
}

async function violations(page) {
    // Animations must be finished first: mid-transition, buttons are briefly smaller than
    // they really are and axe reports target-size violations that users never see
    await waitForAnimations(page);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    return results.violations;
}

test.describe('automated accessibility check (axe-core)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Let the entrance animation finish so axe sees the settled page
        await expect(page.locator('#cookie')).toHaveClass(/visible/);
    });

    test('opening screen', async ({ page }) => {
        expectOnlyKnown(await violations(page), KNOWN_VIOLATIONS.initial);
    });

    test('fortune revealed', async ({ page }) => {
        await crackCookie(page);
        await expect(page.locator('#fortuneSlip')).toBeVisible();
        expectOnlyKnown(await violations(page), KNOWN_VIOLATIONS.cracked);
    });

    test('history open', async ({ page }) => {
        await openHistory(page);
        expectOnlyKnown(await violations(page), KNOWN_VIOLATIONS.historyOpen);
    });
});

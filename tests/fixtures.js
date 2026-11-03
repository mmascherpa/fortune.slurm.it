// Shared helpers: a stubbed AdviceSlip API and seeded browser storage,
// so every test starts from a known, offline state.
const base = require('@playwright/test');

const API_PATTERN = '**/api.adviceslip.com/**';

function makeHistoryItem(i, isFavorite = false, extra = {}) {
    return {
        message: `Fortune ${i}`,
        timestamp: Date.now() - i * 60000,
        isFavorite,
        luckyNumbers: [i % 99 + 1],
        id: null,
        ...extra
    };
}

const test = base.test.extend({
    // { history: [...] } seeds localStorage before the app loads.
    // (Wrapped in an object because test.use() reads a bare array as [value, options].)
    seed: [null, { option: true }],
    // 'stub' (default) answers with unique advice, 'offline' aborts every request
    api: ['stub', { option: true }],

    page: async ({ page, seed, api }, use) => {
        let n = 0;
        await page.route(API_PATTERN, route => {
            if (api === 'offline') return route.abort();
            n++;
            return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ slip: { id: 1000 + n, advice: `Stub advice ${n}` } })
            });
        });
        if (seed) {
            // Seed once per tab, so reloads see what the app saved rather than the seed
            await page.addInitScript(history => {
                if (!sessionStorage.getItem('__seeded')) {
                    localStorage.setItem('fortune_history', JSON.stringify(history));
                    sessionStorage.setItem('__seeded', '1');
                }
            }, seed.history);
        }
        await use(page);
    }
});

async function crackCookie(page) {
    await page.locator('#cookieContainer').click();
    await base.expect(page.locator('#fortuneText')).not.toBeEmpty();
}

const crackedCount = page => page.evaluate(() => fortuneApp.messageManager.getFortuneCount());

// Press "Crack another cookie" and wait until the next fortune is showing. Waits on the
// cracked-cookies count, not on the text changing: when the queue runs dry the app serves
// random fallback messages, and the same one can come up twice in a row.
async function crackAnother(page) {
    const before = await crackedCount(page);
    await page.locator('#crackAnotherBtn').click();
    await base.expect.poll(() => crackedCount(page)).toBe(before + 1);
    await base.expect(page.locator('#cookieStage')).toHaveClass(/cracked/);
}

// Wait for running CSS animations and transitions to finish, so checks see the settled
// layout rather than, say, a fortune slip that is still growing from zero size. Decorative
// aria-hidden elements (the falling particles, spawned continuously) are ignored.
async function waitForAnimations(page) {
    await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(animation => {
            const target = animation.effect && animation.effect.target;
            return target && !target.closest('[aria-hidden="true"]')
                && animation.effect.getComputedTiming().iterations !== Infinity;
        })
        .map(animation => animation.finished.catch(() => {}))));
}

async function openHistory(page) {
    await page.locator('#historyToggle').click();
    await base.expect(page.locator('#historyPanel')).toHaveAttribute('open');
}

module.exports = { test, expect: base.expect, makeHistoryItem, crackCookie, crackAnother, openHistory, waitForAnimations };

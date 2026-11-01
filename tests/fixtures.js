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

async function closeFortune(page) {
    await page.locator('#closeBtn').click();
}

async function openHistory(page) {
    await page.locator('#historyToggle').click();
    await base.expect(page.locator('#historyPanel')).toHaveClass(/open/);
}

module.exports = { test, expect: base.expect, makeHistoryItem, crackCookie, closeFortune, openHistory };

const { test, expect, crackCookie } = require('./fixtures');

// Count audio and vibration use instead of producing real sound
async function stubAudioAndVibration(page) {
    await page.addInitScript(() => {
        window.__effects = { contexts: 0, sounds: 0, vibrations: 0 };
        const node = () => ({ connect() {}, frequency: {}, Q: {}, gain: {} });
        window.AudioContext = class {
            constructor() { window.__effects.contexts++; }
            get state() { return 'running'; }
            get currentTime() { return 0; }
            get sampleRate() { return 8000; }
            get destination() { return {}; }
            resume() {}
            createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
            createBufferSource() { return { ...node(), start() { window.__effects.sounds++; } }; }
            createBiquadFilter() { return node(); }
            createGain() { return node(); }
        };
        navigator.vibrate = () => { window.__effects.vibrations++; return true; };
    });
}

const effects = page => page.evaluate(() => window.__effects);
const soundToggle = page => page.getByRole('button', { name: 'Sound effects' });
// How many pixels of the crumbs canvas have been drawn on
const drawnPixels = page => page.locator('#crumbsCanvas').evaluate(canvas => {
    if (!canvas.width || !canvas.height) return 0;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
});

test.describe('crumbs', () => {
    test('fly out when the cookie cracks', async ({ page }) => {
        await page.goto('/');
        expect(await drawnPixels(page)).toBe(0);
        await crackCookie(page);
        await expect.poll(() => drawnPixels(page)).toBeGreaterThan(0);
        // Drawn above the page but never blocking clicks, and hidden from screen readers
        await expect(page.locator('#crumbsCanvas')).toHaveCSS('pointer-events', 'none');
        await expect(page.locator('#crumbsCanvas')).toHaveAttribute('aria-hidden', 'true');
    });

    test('are skipped when the visitor prefers reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        await crackCookie(page);
        await page.waitForTimeout(800);
        expect(await drawnPixels(page)).toBe(0);
    });

    test('the cookie still works if the effects library fails to load', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('**/vendor/canvas-confetti/**', route => route.abort());
        await page.goto('/');
        await crackCookie(page);
        await page.waitForTimeout(800);
        await expect(page.locator('#fortuneSlip')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('sound and vibration', () => {
    test.beforeEach(async ({ page }) => {
        await stubAudioAndVibration(page);
        await page.goto('/');
    });

    test('are off by default: cracking is silent', async ({ page }) => {
        await expect(soundToggle(page)).toHaveAttribute('aria-pressed', 'false');
        await crackCookie(page);
        await page.waitForTimeout(800);
        expect(await effects(page)).toEqual({ contexts: 0, sounds: 0, vibrations: 0 });
    });

    test('turning sound on plays a preview, then each crack crunches and buzzes', async ({ page }) => {
        await soundToggle(page).click();
        await expect(soundToggle(page)).toHaveAttribute('aria-pressed', 'true');
        expect(await effects(page)).toEqual({ contexts: 1, sounds: 3, vibrations: 0 });

        await crackCookie(page);
        await expect.poll(() => effects(page)).toEqual({ contexts: 1, sounds: 6, vibrations: 1 });
    });

    test('the choice is remembered', async ({ page }) => {
        await soundToggle(page).click();
        await page.reload();
        await expect(soundToggle(page)).toHaveAttribute('aria-pressed', 'true');
        await soundToggle(page).click();
        await page.reload();
        await expect(soundToggle(page)).toHaveAttribute('aria-pressed', 'false');
    });

    test('turning it off again silences cracks', async ({ page }) => {
        await soundToggle(page).click();
        await soundToggle(page).click();
        await crackCookie(page);
        await page.waitForTimeout(800);
        expect((await effects(page)).sounds).toBe(3); // only the preview
        expect((await effects(page)).vibrations).toBe(0);
    });
});

for (const width of [360, 412, 768, 1280]) {
    test(`sound button does not overlap the title at ${width}px wide`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/');
        await expect(page.locator('.title')).toBeVisible();
        const button = await soundToggle(page).boundingBox();
        const lines = await page.locator('.title').evaluate(el => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return Array.from(range.getClientRects()).map(r => ({ top: r.top, bottom: r.bottom, left: r.left }));
        });
        const overlapping = lines.filter(line =>
            line.top < button.y + button.height && line.bottom > button.y && line.left < button.x + button.width);
        expect(overlapping).toEqual([]);
    });
}

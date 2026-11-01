# Digital Fortune Cookie

Source for [fortune.slurm.it](https://fortune.slurm.it): crack a cookie, read your fortune, keep the ones you like.

It is a static site — `index.html`, `styles.css`, `app.js` — with no build step. Fortunes come from the
[AdviceSlip API](https://api.adviceslip.com), fetched in the background into a small queue, with built-in
fortunes as a fallback when offline. History and favourites are kept in the browser's `localStorage`.

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Add `?debug` to the URL to log queue and API activity to the console.

## Tests

Browser tests use [Playwright](https://playwright.dev) and check accessibility with
[axe-core](https://github.com/dequelabs/axe-core). They stub the AdviceSlip API, so they run offline.

```bash
npm ci
npx playwright install chromium   # first time only
npm test
```

Tests run on desktop and mobile (Pixel 7) viewports, and on every pull request via GitHub Actions
(`.github/workflows/tests.yml`).

## Deployment

GitHub Pages serves the `main` branch at the custom domain in `CNAME`. Merging to `main` deploys.

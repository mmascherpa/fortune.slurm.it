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

Merging to `main` runs `.github/workflows/pages.yml`, which builds `_site/` with
`scripts/build-site.sh`, runs the browser tests against it, and publishes it to GitHub Pages.
Only the files listed in that script are published; tests, tooling and docs are not.

When you add a file the page needs at runtime (a script, image, folder), add it to
`SITE_FILES` in `scripts/build-site.sh`. Pull requests run the tests against the built folder
too, so a missing entry fails CI before it can break the live site. To check locally:

```bash
npm run test:site
```

GitHub Pages must be set to deploy from GitHub Actions (Settings → Pages → Build and
deployment → Source). The custom domain is configured there as well; with Actions
deployments the `CNAME` file in the repo is not used.

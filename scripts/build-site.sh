#!/usr/bin/env bash
# Copy the files the website needs into an output folder (default: _site).
# This list is the only thing GitHub Pages publishes: tests, tooling and docs stay
# out. Add new runtime files and folders here; CI runs the browser tests against the
# built folder, so anything the page needs but is missing from the list fails them.
set -euo pipefail

OUT="${1:-_site}"

SITE_FILES=(
    index.html
    app.js
    styles.css
    favicon.svg
    vendor          # canvas-confetti, with its licence
)

cd "$(dirname "$0")/.."
rm -rf "$OUT"
mkdir -p "$OUT"
for path in "${SITE_FILES[@]}"; do
    cp -R "$path" "$OUT/"
done

echo "Built $OUT:"
(cd "$OUT" && find . -type f | sort | sed 's|^\./|  |')

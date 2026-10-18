# Deployment

## Netlify
Deploy the repository root as a static site.

## Cloudflare Pages
- Framework preset: None
- Build command: leave blank
- Build output directory: `/` or repository root depending on the UI
- Root file: `index.html`

## GitHub Pages
This can also run directly from the repository root with GitHub Pages enabled.

## Important
App data lives in browser localStorage. Changing the deployed domain creates a new browser storage origin. Use the app's backup/restore feature when moving to a different domain.

# Deployment

Cloudflare Workers with static assets + D1. See `wrangler.jsonc`.

1. Cloudflare dashboard → Workers & Pages → `cloehealthapp` → Settings → Build → Connect to Git.
2. Repo `heinrichmakernthings/cloehealthapp`, branch `main`. Build command: blank. Deploy command: `npx wrangler deploy`.
3. Push to `main` to deploy.

Keep the worker name and the `*.workers.dev` address the same — Cloe's on-device data is tied to that address.

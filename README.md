# engineer_nitk26

ENGINEER '26 — Cognitrixx: Rewire Reality. The website for NIT Karnataka's
technical festival.

## Run it locally

Needs Node.js 20.6 or newer.

```bash
npm install
npm run dev          # http://localhost:3000
```

The compiled stylesheet (`public/src/output.css`) is committed, so the site
runs as-is. After editing `public/src/input.css`, rebuild it:

```bash
npm run build:css    # one-off build
npm run watch:css    # rebuild on every save
```

Deployment is covered in [DEPLOY.md](DEPLOY.md); how the site is put together
is in [project_context.md](project_context.md).

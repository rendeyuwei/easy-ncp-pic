# EasyPic

[简体中文](README.zh-CN.md)

**Your photo. Your look. Your browser.**

EasyPic is a browser-based photo tool built specifically around Nikon Picture Control (`.ncp`) filters. Every published look is derived from real NCP data—not a grab bag of generic presets. Open a JPG or PNG, explore distinctive NCP looks, compare every detail, tune the intensity, and export at the original dimensions—all without handing your photo to a remote editor.

> Ready to see what your photo could become? [Run EasyPic locally](#try-it-locally) and start exploring in a few minutes.

## Why EasyPic?

Your photo is decoded, previewed, filtered, and exported inside the browser. It is **not uploaded to the EasyPic server**. The server only delivers the application and published filter parameters, so you can experiment freely without sending personal images across the network.

EasyPic focuses on making NCP Picture Controls easy to experience outside a traditional desktop workflow. It is an independent project and does not claim affiliation with Nikon or pixel-identical output with Nikon software.

## What You Can Do

- Drop in one JPG or PNG and start editing—no account required.
- Browse curated NCP-based filters with previews generated from your own photo.
- Compare the original and filtered image, then adjust filter intensity from 0–100%.
- Switch between a responsive light or dark workspace on desktop and mobile.
- Export JPG or lossless PNG at the photo's original pixel dimensions.
- Keep the interface responsive while a Web Worker handles image processing.
- Use WebGL acceleration when available, with an automatic Canvas 2D fallback.

## Try It Locally

You need [Node.js](https://nodejs.org/) `>=20.19.0 <21` or `>=22.12.0` and pnpm `9.12.1`.

```bash
git clone https://github.com/rendeyuwei/easypic.git
cd easypic
pnpm install
cp .env.local.example .env.local
```

Open `.env.local` and replace the example session secret and administrator password with local values, then start the complete stack:

```bash
pnpm dev
```

The launcher builds the internal libraries and starts the API, public editor, and administration app together. Press `Ctrl+C` to stop them.

## Local Services

| Service | URL | Purpose |
| --- | --- | --- |
| Public editor | <http://127.0.0.1:5173/> | Open a photo and explore filters |
| Administration | <http://127.0.0.1:5174/admin/> | Manage categories and published filters |
| API health | <http://127.0.0.1:3000/api/health> | Confirm the API and database are ready |

## How It Works

1. The browser reads your local photo, applies EXIF orientation, and prepares a responsive preview.
2. The API supplies published NCP filter parameters—never your photo pixels.
3. A Web Worker generates thumbnails and previews through WebGL or the Canvas fallback.
4. You compare the result, choose the strength, and export through the same local image pipeline.

## Workspace

EasyPic is a pnpm TypeScript monorepo with focused packages:

| Package | Responsibility |
| --- | --- |
| `@easypic/web-app` | Public React/Vite photo editor |
| `@easypic/admin-app` | Authenticated filter and category management UI |
| `@easypic/api-server` | Fastify public and administration APIs |
| `@easypic/database` | SQLite schema, migrations, sessions, and storage |
| `@easypic/image-engine` | Decode, render, compare, and export pipeline |
| `@easypic/ncp-parser` | Strict Nikon NCP validation and parsing |

## Development

Run these commands from the repository root:

```bash
pnpm test                                      # all Vitest suites
pnpm test:dev-script                           # local launcher checks
pnpm -r build                                  # build every workspace package
pnpm -r typecheck                              # strict TypeScript checks
pnpm --filter @easypic/web-app test:e2e        # public editor Playwright suite
pnpm --filter @easypic/admin-app test:e2e      # administration Playwright suite
pnpm --filter @easypic/image-engine test:browser # browser renderer checks
```

See [AGENTS.md](AGENTS.md) for repository conventions and contribution checks.

## Current Scope

EasyPic currently processes one JPG or PNG at a time. It does not accept RAW/NEF, HEIF, `.np2`, or `.np3` input, and it does not provide cloud albums, user accounts, or batch processing. Filter management is intended for a single administrator. Keeping this first experience focused lets EasyPic stay fast, private, and easy to understand.

## Contributing

Ideas, fixes, tests, and thoughtful new filters are welcome. Open an issue to discuss a meaningful change, then send a focused pull request with the checks you ran and screenshots for visible UI updates. Help make private, expressive photo editing easier for everyone.

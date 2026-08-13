# EasyPic Bilingual README Design

**Date:** 2026-08-13

## Goal

Create an inviting project introduction that motivates photographers and casual users to try EasyPic while still giving contributors an accurate path to run and understand the repository. The README must present implemented behavior only and avoid implying that an online demo already exists.

## Files and Language Navigation

- `README.md` is the English default shown by GitHub.
- `README.zh-CN.md` is the complete Simplified Chinese version.
- Both files begin with a compact language switch linking to the other file.
- The two documents use the same information hierarchy and commands, but the prose is written naturally in each language rather than translated word for word.

## Message and Tone

Lead with the experience: open a photo, explore curated looks, compare the result, and export at the original dimensions. The primary differentiator is privacy—photo decoding, previewing, filtering, and exporting happen inside the browser, so user photos are not uploaded to the server.

The copy should feel confident, visual, and approachable without exaggeration. Nikon NCP support is a concrete technical distinction, not an affiliation claim or a promise of pixel-identical output with Nikon software.

## Content Structure

Each README follows this sequence:

1. Product name, one-line promise, language switch, and a short call to action.
2. A concise overview centered on local processing and an easy upload-to-export workflow.
3. Feature highlights: curated NCP-based filters, live thumbnails, original/filter comparison, adjustable intensity, JPG/PNG input, original-dimension export, Web Worker processing, WebGL acceleration with Canvas fallback, responsive UI, and light/dark themes.
4. “Try it locally” instructions using the repository's Node and pnpm requirements, `.env.local.example`, `pnpm install`, and `pnpm dev`.
5. Local service URLs for the public editor, API health endpoint, and administration app.
6. A short architecture overview of the six workspace packages.
7. Development commands for tests, builds, type checks, and package-specific E2E suites.
8. Current scope and limitations, followed by contribution guidance.

## Demo and Media Handling

The first version does not include a dead URL, fake badge, or fabricated screenshot. Local startup is the immediate experience CTA. When hosting is available, add one prominent demo link near the hero in both files. Screenshots or a short GIF can be added later from real product captures without restructuring the document.

## Accuracy and Safety Constraints

- State that user photos remain local; the server supplies filter parameters and administration APIs.
- Describe only JPG/PNG, one-photo-at-a-time processing and current export behavior.
- Do not add a license section until a repository license exists.
- Do not expose example secrets or suggest committing `.env.local` or SQLite data.
- Preserve exact command and package names from `package.json` and the workspace.

## Verification

Before delivery, compare the two README outlines section by section, validate all relative links, confirm every command against package scripts, scan for placeholders and unsupported claims, and run Markdown whitespace checks. Documentation-only changes do not require the application test suite.

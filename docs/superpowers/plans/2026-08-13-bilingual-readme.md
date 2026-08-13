# Bilingual README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create persuasive, accurate English and Simplified Chinese README files that invite users to experience EasyPic locally and give contributors a concise development reference.

**Architecture:** `README.md` is the GitHub-default English landing page and `README.zh-CN.md` is its naturally localized Chinese counterpart. Both documents share the same section order, commands, claims, and cross-language navigation, while each uses idiomatic copy rather than literal translation.

**Tech Stack:** GitHub-flavored Markdown, pnpm 9.12.1, Node.js `>=20.19.0 <21 || >=22.12.0`, React/Vite, Fastify, SQLite, Vitest, Playwright

## Global Constraints

- Present only implemented behavior: JPG/PNG, one photo at a time, local browser processing, NCP-based filters, comparison, strength adjustment, and original-dimension export.
- Say that the server supplies filter parameters and admin APIs; user photos are not uploaded.
- Use local startup as the current experience CTA. Add no online-demo URL, screenshot, license section, fake badge, or affiliation claim.
- Keep commands and workspace package names exactly aligned with repository scripts.
- Preserve all unrelated working-tree and index changes.

---

### Task 1: English Project Landing Page

**Files:**
- Create: `README.md`
- Reference: `docs/superpowers/specs/2026-08-13-bilingual-readme-design.md`
- Reference: `package.json`
- Reference: `.env.local.example`

**Interfaces:**
- Consumes: root/package scripts, six `@easypic/*` workspace package names, and the approved messaging constraints.
- Produces: GitHub's default project landing page and a relative language link to `README.zh-CN.md`.

- [ ] **Step 1: Confirm the target is still safe to create**

Run:

```bash
test ! -e README.md
```

Expected: exit 0. If the file exists, stop and review it before changing anything.

- [ ] **Step 2: Write the English README**

Create `README.md` with these exact headings in this order:

```markdown
# EasyPic
## Why EasyPic?
## What You Can Do
## Try It Locally
## Local Services
## How It Works
## Workspace
## Development
## Current Scope
## Contributing
```

Put `[简体中文](README.zh-CN.md)` directly below the title. Open with a short promise built around “Your photo. Your look. Your browser.” and a direct invitation to turn an ordinary JPG or PNG into a distinctive image without uploading it. Explain privacy before technology. Use compact bullets for features, a four-command quick start (`pnpm install`, copy `.env.local.example`, edit local secrets, `pnpm dev`), a table for local URLs, a short browser-to-export flow, a six-package workspace table, and verified development commands. End with a warm contribution invitation.

- [ ] **Step 3: Validate English claims and commands**

Run:

```bash
rg -n "pnpm install|cp .env.local.example .env.local|pnpm dev|pnpm test|pnpm -r build|pnpm -r typecheck" README.md
rg -n "JPG|PNG|Web Worker|WebGL|Canvas|NCP|original" README.md
```

Expected: every command and core implemented capability appears at least once. Manually compare the claims with `package.json`, `scripts/dev.sh`, and the approved design.

- [ ] **Step 4: Check Markdown hygiene**

Run:

```bash
awk '/[[:blank:]]+$/ { print "trailing whitespace at line " NR; bad=1 } END { exit bad }' README.md
```

Expected: exit 0 with no output.

- [ ] **Step 5: Commit the English README**

```bash
git add README.md
git commit --only README.md -m "docs(readme): introduce EasyPic in English"
```

### Task 2: Chinese Localization and Cross-Language Parity

**Files:**
- Create: `README.zh-CN.md`
- Verify: `README.md`

**Interfaces:**
- Consumes: the structure and factual content of `README.md`.
- Produces: a complete Simplified Chinese landing page linking back to `README.md`, with matching commands and product scope.

- [ ] **Step 1: Confirm the Chinese target is safe to create**

Run:

```bash
test ! -e README.zh-CN.md
```

Expected: exit 0. If the file exists, stop and review it before changing anything.

- [ ] **Step 2: Write the Chinese README**

Create `README.zh-CN.md` with this matching heading sequence:

```markdown
# EasyPic
## 为什么选择 EasyPic？
## 你可以做什么
## 本地体验
## 本地服务
## 工作原理
## 工作区结构
## 开发与验证
## 当前范围
## 参与贡献
```

Put `[English](README.md)` directly below the title. Write natural Chinese copy around “你的照片，你的质感，只在你的浏览器里完成。” Preserve all English facts, commands, local URLs, package names, and limitations. Keep the voice vivid and welcoming rather than translating sentence by sentence.

- [ ] **Step 3: Verify navigation, command parity, and scope parity**

Run:

```bash
test -f README.md && test -f README.zh-CN.md
rg -n "README.zh-CN.md" README.md
rg -n "README.md" README.zh-CN.md
diff \
  <(rg '^pnpm |^cp \.env' README.md | sed 's/[[:space:]]*#.*$//') \
  <(rg '^pnpm |^cp \.env' README.zh-CN.md | sed 's/[[:space:]]*#.*$//')
```

Expected: both files exist, both language links are found, and the command comparison—excluding localized explanatory comments—has no differences.

- [ ] **Step 4: Run final documentation checks**

Run:

```bash
awk '/[[:blank:]]+$/ { print FILENAME ":" NR; bad=1 } END { exit bad }' README.md README.zh-CN.md
git diff --check -- README.md README.zh-CN.md
rg -n "TBD|TODO|example\.com|coming soon|即将上线" README.md README.zh-CN.md
```

Expected: the whitespace commands exit 0; the placeholder scan returns no matches. Review both rendered outlines and confirm the same ten sections, six packages, three service URLs, and development commands are present.

- [ ] **Step 5: Commit the Chinese README**

```bash
git add README.zh-CN.md
git commit --only README.zh-CN.md -m "docs(readme): add Simplified Chinese guide"
```

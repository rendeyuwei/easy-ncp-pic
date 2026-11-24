export const SHELL_TOPBAR_SRC = '/shell/topbar.4a304e017601ad56e80a5c39886c186fa462161ce585d093ae92c4cfc17edd7b.js';
export const SHELL_LANG_SRC = '/shell/lang.3effebca35bf58244e77657ead34de9f6afb4416ffdc3ba5a0bbcd4f2933c70d.js';
export const SHELL_CSS_SRC = '/shell/topbar.918f2c1a3eaa24581dfb11b360b323fa925b5a2548108b6ad5d8bd98ff3cc23b.css';

const TOPBAR_TAG = `<script src="${SHELL_TOPBAR_SRC}" defer data-tool="easypic"></script>`;
const LANG_TAG = `<script src="${SHELL_LANG_SRC}"></script>`;

export function preserveShellTopbarHtml(html: string): string {
  return html
    .replaceAll(
      /<script\b[^>]*\bsrc="[^"]*\/shell\/topbar(?:\.[0-9a-f]{64})?\.js"[^>]*>\s*<\/script>/g,
      TOPBAR_TAG,
    )
    .replaceAll(
      /<script\b[^>]*\bsrc="[^"]*\/shell\/lang(?:\.[0-9a-f]{64})?\.js"[^>]*>\s*<\/script>/g,
      LANG_TAG,
    );
}

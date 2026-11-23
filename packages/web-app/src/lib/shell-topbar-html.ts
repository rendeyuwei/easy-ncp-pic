const TOPBAR_TAG = '<script src="/shell/topbar.js" defer data-tool="easypic"></script>';
const LANG_TAG = '<script src="/shell/lang.js"></script>';

export function preserveShellTopbarHtml(html: string): string {
  return html
    .replaceAll(
      /<script\b[^>]*\bsrc="[^"]*\/shell\/topbar\.js"[^>]*>\s*<\/script>/g,
      TOPBAR_TAG,
    )
    .replaceAll(
      /<script\b[^>]*\bsrc="[^"]*\/shell\/lang\.js"[^>]*>\s*<\/script>/g,
      LANG_TAG,
    );
}

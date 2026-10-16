const TOPBAR_TAG = '<script src="/shell/topbar.js" defer></script>';

export function preserveShellTopbarHtml(html: string): string {
  return html.replaceAll(
    /<script\b[^>]*\bsrc="[^"]*\/shell\/topbar\.js"[^>]*>\s*<\/script>/g,
    TOPBAR_TAG,
  );
}

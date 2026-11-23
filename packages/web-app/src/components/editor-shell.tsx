import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { ImageSessionState } from '../hooks/use-image-session';
import type { Theme } from '../hooks/use-theme';
import { appHomeHref, readBrowserPref } from '../lib/locale';
import { fill } from '../lib/messages';
import type { PublicCategory } from '../lib/filters';
import { useMessages } from '../locale-context';
import { EditorControls } from './editor-controls';
import { ExportDialog } from './export-dialog';
import { FilterBrowser } from './filter-browser';
import { PhotoCompare } from './photo-compare';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export interface EditorShellProps {
  session: ImageSessionState;
  categories: ReadonlyArray<PublicCategory>;
  filtersUnavailable: boolean;
  theme: Theme;
  onToggleTheme(): void;
}

export function EditorShell({
  session,
  categories,
  filtersUnavailable,
  theme,
  onToggleTheme,
}: EditorShellProps) {
  const copy = useMessages();
  const [showOriginal, setShowOriginal] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const image = session.image;
  const homeHref = appHomeHref(
    window.location.pathname,
    window.location.search,
    import.meta.env.BASE_URL,
    readBrowserPref(),
  );

  if (!image || !session.originalPreview || !session.filteredPreview) return null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="wordmark" href={homeHref} aria-label={copy.homeAria}>
          <span aria-hidden="true">EP</span>EasyPic
        </a>
        <div className="header-actions">
          <span className="privacy-pill">{copy.privacyPill}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={theme === 'dark' ? copy.themeToLight : copy.themeToDark}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </Button>
        </div>
      </header>

      <main className="editor-layout">
        <section className="preview-panel" aria-labelledby="active-filter-title">
          <div className="preview-heading">
            <div>
              <p className="eyebrow">{copy.currentLook}</p>
              <h1 id="active-filter-title">{session.selectedFilter?.displayName ?? copy.chooseFilter}</h1>
            </div>
            <span>{image.width} × {image.height}</span>
          </div>

          <PhotoCompare
            original={session.originalPreview}
            filtered={session.filteredPreview}
            showOriginal={showOriginal}
          />

          <EditorControls
            intensity={session.intensity}
            busy={session.busy}
            canAdjustIntensity={
              (session.selectedFilter !== null || session.pendingFilter !== null)
              && !session.loading
              && !session.exporting
            }
            canExport={session.selectedFilter !== null}
            onIntensityChange={session.setIntensity}
            onCompareChange={setShowOriginal}
            onExport={() => setExportOpen(true)}
            onReplace={() => setReplaceOpen(true)}
          />

          <div className="editor-notices" aria-live="polite">
            {filtersUnavailable ? <p>{copy.errors['filters-stale']}</p> : null}
            {session.fallbackNotice ? <p>{session.fallbackNotice}</p> : null}
            {session.error ? <p role="alert">{session.error}</p> : null}
            {session.pendingFilter ? <p role="status">{fill(copy.applying, { name: session.pendingFilter.displayName })}</p> : null}
            {session.busy && !exportOpen ? <p role="status">{copy.processing}</p> : null}
          </div>
        </section>

        <aside className="filter-rail">
          <FilterBrowser
            categories={categories}
            selectedFilterId={session.selectedFilter?.id ?? null}
            pendingFilterId={session.pendingFilter?.id ?? null}
            thumbnails={session.thumbnails}
            loadingIds={session.thumbnailLoading}
            onVisibleFiltersChange={session.requestThumbnails}
            onSelect={(filter) => void session.selectFilter(filter)}
          />
        </aside>
      </main>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        sourceName={session.fileName}
        sourceType={image.sourceFormat}
        width={image.width}
        height={image.height}
        progress={session.progress}
        busy={session.busy}
        onExport={session.exportImage}
      />

      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.replaceTitle}</DialogTitle>
            <DialogDescription>{copy.replaceDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReplaceOpen(false)}>{copy.keepEditing}</Button>
            <Button
              onClick={() => {
                setReplaceOpen(false);
                void session.reset();
              }}
            >
              {copy.confirmReplace}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

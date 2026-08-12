import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { ImageSessionState } from '../hooks/use-image-session';
import type { Theme } from '../hooks/use-theme';
import type { PublicCategory } from '../lib/filters';
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
  const [showOriginal, setShowOriginal] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const image = session.image;

  if (!image || !session.originalPreview || !session.filteredPreview) return null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="EasyPic 首页">
          <span aria-hidden="true">EP</span>EasyPic
        </a>
        <div className="header-actions">
          <span className="privacy-pill">照片仅在本机处理</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
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
              <p className="eyebrow">当前效果</p>
              <h1 id="active-filter-title">{session.selectedFilter?.displayName ?? '选择一个滤镜'}</h1>
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
            canExport={session.selectedFilter !== null}
            onIntensityChange={session.setIntensity}
            onCompareChange={setShowOriginal}
            onExport={() => setExportOpen(true)}
            onReplace={() => setReplaceOpen(true)}
          />

          <div className="editor-notices" aria-live="polite">
            {filtersUnavailable ? <p>滤镜列表暂时无法更新，请稍后重试。</p> : null}
            {session.fallbackNotice ? <p>{session.fallbackNotice}</p> : null}
            {session.error ? <p role="alert">{session.error}</p> : null}
            {session.busy && !exportOpen ? <p role="status">正在处理照片…</p> : null}
          </div>
        </section>

        <aside className="filter-rail">
          <FilterBrowser
            categories={categories}
            selectedFilterId={session.selectedFilter?.id ?? null}
            thumbnails={session.thumbnails}
            loadingIds={session.thumbnailLoading}
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
            <DialogTitle>更换照片？</DialogTitle>
            <DialogDescription>当前滤镜和强度设置会被清除。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReplaceOpen(false)}>继续编辑</Button>
            <Button
              onClick={() => {
                setReplaceOpen(false);
                void session.reset();
              }}
            >
              确认更换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

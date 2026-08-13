import { useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { EditorShell } from './components/editor-shell';
import { UploadScreen } from './components/upload-screen';
import { Button } from './components/ui/button';
import { useFilters } from './hooks/use-filters';
import { useImageSession } from './hooks/use-image-session';
import { useTheme } from './hooks/use-theme';

export function App() {
  const filtersQuery = useFilters();
  const filters = useMemo(
    () => filtersQuery.data?.categories.flatMap((category) => category.filters) ?? [],
    [filtersQuery.data],
  );
  const session = useImageSession(filters);
  const [selectedFileName, setSelectedFileName] = useState('');
  const { theme, toggleTheme } = useTheme();

  if (!session.image || !session.originalPreview || !session.filteredPreview) {
    const queryError = filtersQuery.error instanceof Error ? '滤镜暂时无法加载，请稍后重试。' : null;
    return (
      <div className="app-shell app-shell--upload">
        <Button
          className="upload-theme-toggle"
          variant="ghost"
          size="icon"
          aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
        <UploadScreen
          selectedFileName={selectedFileName}
          busy={session.busy}
          progress={session.progress}
          error={session.error ?? queryError}
          onFile={(file) => {
            setSelectedFileName(file.name);
            void session.load(file);
          }}
        />
      </div>
    );
  }

  return (
    <EditorShell
      session={session}
      categories={filtersQuery.data?.categories ?? []}
      filtersUnavailable={filtersQuery.error !== null}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

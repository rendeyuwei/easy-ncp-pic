import { useMemo, useState } from 'react';
import { UploadScreen } from './components/upload-screen';
import { useFilters } from './hooks/use-filters';
import { useImageSession } from './hooks/use-image-session';

export function App() {
  const filtersQuery = useFilters();
  const filters = useMemo(
    () => filtersQuery.data?.categories.flatMap((category) => category.filters) ?? [],
    [filtersQuery.data],
  );
  const session = useImageSession(filters);
  const [selectedFileName, setSelectedFileName] = useState('');

  if (!session.image || !session.originalPreview || !session.filteredPreview) {
    const queryError = filtersQuery.error instanceof Error ? '滤镜暂时无法加载，请稍后重试。' : null;
    return (
      <UploadScreen
        selectedFileName={selectedFileName}
        busy={session.busy}
        error={session.error ?? queryError}
        onFile={(file) => {
          setSelectedFileName(file.name);
          void session.load(file);
        }}
      />
    );
  }

  return (
    <main className="editor-initializing">
      <p role="status">编辑器正在初始化</p>
      <p>{session.fileName}</p>
    </main>
  );
}

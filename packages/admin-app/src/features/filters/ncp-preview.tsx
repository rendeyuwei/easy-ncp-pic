import type { ParsedPictureControl } from '@easypic/ncp-parser';

interface NcpPreviewProps {
  parsed: ParsedPictureControl;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export function NcpPreview({ parsed }: NcpPreviewProps) {
  const monochrome = parsed.basePictureControl.name === 'Monochrome';
  const warnings = parsed.warnings.length > 0 ? parsed.warnings.join('；') : '未发现警告。';

  return (
    <section className="ncp-preview" aria-label="NCP 详情">
      <dl>
        <Detail label="来源名称">{parsed.sourceName}</Detail>
        <Detail label="来源版本">{parsed.sourceVersion}</Detail>
        <Detail label="Schema 版本">{parsed.schemaVersion}</Detail>
        <Detail label="基础模式">{parsed.basePictureControl.name}</Detail>
        <Detail label="曲线">{parsed.customCurve.enabled ? '已启用' : '未启用'}</Detail>
        <Detail label="控制点">{parsed.customCurve.controlPoints.length}</Detail>
        <Detail label="LUT 条目">{parsed.customCurve.lut257.length}</Detail>
        <Detail label="锐化">{parsed.sharpening}</Detail>
        {monochrome ? (
          <>
            <Detail label="滤镜效果">{parsed.monochromeFilter?.name ?? '未知'}</Detail>
            <Detail label="色调">{parsed.toningType?.name ?? '未知'}</Detail>
            <Detail label="色调强度">{parsed.toningStrength ?? '未知'}</Detail>
          </>
        ) : (
          <>
            <Detail label="饱和度">{parsed.saturation}</Detail>
            <Detail label="色相">{parsed.hue}</Detail>
          </>
        )}
      </dl>
      <p role="status" aria-live="polite">
        {parsed.supported ? '当前版本支持此 NCP。' : '当前版本不支持此 NCP。'} {warnings}
      </p>
    </section>
  );
}

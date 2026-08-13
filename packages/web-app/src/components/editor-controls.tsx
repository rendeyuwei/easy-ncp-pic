import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Download, Images, ScanEye } from 'lucide-react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

export interface EditorControlsProps {
  intensity: number;
  busy: boolean;
  canAdjustIntensity: boolean;
  canExport: boolean;
  onIntensityChange(value: number): void;
  onCompareChange(showOriginal: boolean): void;
  onExport(): void;
  onReplace(): void;
}

export function EditorControls({
  intensity,
  busy,
  canAdjustIntensity,
  canExport,
  onIntensityChange,
  onCompareChange,
  onExport,
  onReplace,
}: EditorControlsProps) {
  const [holding, setHolding] = useState(false);

  const setOriginal = (show: boolean): void => {
    setHolding(show);
    onCompareChange(show);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setOriginal(true);
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setOriginal(false);
  };

  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, show: boolean): void => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    setOriginal(show);
  };

  return (
    <section className="editor-controls" aria-label="照片调整">
      <div className="intensity-control">
        <div className="control-label">
          <label>滤镜强度</label>
          <output>{Math.round(intensity * 100)}%</output>
        </div>
        <Slider
          aria-label="滤镜强度"
          min={0}
          max={100}
          step={1}
          value={[Math.round(intensity * 100)]}
          disabled={!canAdjustIntensity}
          onValueChange={([value]) => onIntensityChange((value ?? 0) / 100)}
        />
      </div>

      <div className="editor-actions">
        <Button
          variant="secondary"
          aria-pressed={holding}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setOriginal(false)}
          onBlur={() => setOriginal(false)}
          onKeyDown={(event) => handleKey(event, true)}
          onKeyUp={(event) => handleKey(event, false)}
        >
          <ScanEye aria-hidden="true" />按住看原图
        </Button>
        <Button variant="secondary" onClick={onReplace}>
          <Images aria-hidden="true" />更换照片
        </Button>
        <Button disabled={!canExport || busy} onClick={onExport}>
          <Download aria-hidden="true" />导出
        </Button>
      </div>
    </section>
  );
}

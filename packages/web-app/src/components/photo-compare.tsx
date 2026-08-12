import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PixelBuffer } from '@easypic/image-engine';
import { drawPixelBuffer } from '../lib/pixels';

export interface PhotoCompareProps {
  original: PixelBuffer;
  filtered: PixelBuffer;
  showOriginal: boolean;
}

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function PhotoCompare({ original, filtered, showOriginal }: PhotoCompareProps) {
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const filteredCanvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const [position, setPosition] = useState(50);

  useEffect(() => {
    if (originalCanvas.current) drawPixelBuffer(originalCanvas.current, original);
  }, [original]);

  useEffect(() => {
    if (filteredCanvas.current) drawPixelBuffer(filteredCanvas.current, filtered);
  }, [filtered]);

  const positionFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setPosition(clampPercentage(((event.clientX - rect.left) / rect.width) * 100));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next = position;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 2;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 2;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 100;
    else return;
    event.preventDefault();
    setPosition(clampPercentage(next));
  };

  return (
    <figure
      className="photo-compare"
      style={{ aspectRatio: `${original.width} / ${original.height}` }}
      aria-label="照片滤镜预览"
    >
      <div
        className="photo-compare__surface"
        data-testid="compare-surface"
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          positionFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) positionFromPointer(event);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <canvas ref={originalCanvas} className="photo-compare__canvas" aria-label="原图" />
        <div
          className="photo-compare__filtered"
          data-testid="filtered-layer"
          style={{ clipPath: `inset(0 ${showOriginal ? 100 : 100 - position}% 0 0)` }}
        >
          <canvas ref={filteredCanvas} className="photo-compare__canvas" aria-label="滤镜效果" />
        </div>
        {!showOriginal ? (
          <div
            className="photo-compare__divider"
            role="slider"
            tabIndex={0}
            aria-label="原图与滤镜对比"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={position}
            aria-valuetext={`滤镜 ${position}%`}
            style={{ left: `${position}%` }}
            onKeyDown={handleKeyDown}
          >
            <span aria-hidden="true" className="photo-compare__handle" />
          </div>
        ) : (
          <div
            className="visually-hidden"
            role="slider"
            aria-label="原图与滤镜对比"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={position}
            aria-valuetext={`滤镜 ${position}%`}
          />
        )}
        <span className="photo-compare__label photo-compare__label--original">原图</span>
        <span className="photo-compare__label photo-compare__label--filtered">滤镜</span>
      </div>
    </figure>
  );
}

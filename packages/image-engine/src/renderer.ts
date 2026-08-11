import type { FilterParams } from './params';
import { renderCanvas, type RenderableImage } from './render-canvas';

export type RendererKind = 'canvas' | 'webgl';

export interface ImageRenderer {
  readonly kind: RendererKind;
  render(image: RenderableImage, params: FilterParams, intensity?: number): RenderableImage;
  dispose?(): void;
}

export const canvasRenderer: ImageRenderer = {
  kind: 'canvas',
  render: renderCanvas,
};

export function createFallbackRenderer(
  primary: ImageRenderer,
  fallback: ImageRenderer = canvasRenderer,
  onFallback?: (error: unknown) => void,
): ImageRenderer {
  let active = primary;
  let reported = false;
  return {
    get kind() {
      return active.kind;
    },
    render(image, params, intensity = 1) {
      try {
        return active.render(image, params, intensity);
      } catch (error) {
        if (active === fallback) throw error;
        active.dispose?.();
        active = fallback;
        if (!reported) {
          reported = true;
          onFallback?.(error);
        }
        return active.render(image, params, intensity);
      }
    },
    dispose() {
      primary.dispose?.();
      if (fallback !== primary) fallback.dispose?.();
    },
  };
}

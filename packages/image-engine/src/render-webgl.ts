import type { FilterParams } from './params';
import type { RenderableImage } from './render-canvas';
import { canvasRenderer, createFallbackRenderer, type ImageRenderer } from './renderer';
import { packWebGLParams } from './webgl-params';
import { FILTER_FRAGMENT_SHADER, FINAL_FRAGMENT_SHADER, FULLSCREEN_VERTEX_SHADER } from './webgl-shaders';

export type WebGLCanvas = HTMLCanvasElement | OffscreenCanvas;
export type WebGLCanvasFactory = (width: number, height: number) => WebGLCanvas;

export interface WebGLRendererOptions {
  canvasFactory?: WebGLCanvasFactory;
}

export class WebGLRendererError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGLRendererError';
  }
}

function defaultCanvasFactory(width: number, height: number): WebGLCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new WebGLRendererError('No browser canvas implementation is available');
}

function required<T>(value: T | null, message: string): T {
  if (value === null) throw new WebGLRendererError(message);
  return value;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = required(gl.createShader(type), 'Unable to create WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader compile error';
    gl.deleteShader(shader);
    throw new WebGLRendererError(`WebGL shader compilation failed: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = required(gl.createProgram(), 'Unable to create WebGL program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown program link error';
    gl.deleteProgram(program);
    throw new WebGLRendererError(`WebGL program linking failed: ${log}`);
  }
  return program;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = required(gl.createTexture(), 'Unable to create WebGL texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  return required(gl.getUniformLocation(program, name), `Missing WebGL uniform ${name}`);
}

class WebGLRenderer implements ImageRenderer {
  readonly kind = 'webgl' as const;
  private readonly canvas: WebGLCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly filterProgram: WebGLProgram;
  private readonly finalProgram: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sourceTexture: WebGLTexture;
  private readonly filteredTexture: WebGLTexture;
  private readonly curveTexture: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  private unusable = false;
  private disposed = false;

  constructor(factory: WebGLCanvasFactory) {
    this.canvas = factory(1, 1);
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    this.gl = required(gl, 'WebGL2 is unavailable');
    if (!this.gl.getExtension('EXT_color_buffer_float')) {
      throw new WebGLRendererError('WebGL2 EXT_color_buffer_float is unavailable');
    }
    this.filterProgram = createProgram(this.gl, FILTER_FRAGMENT_SHADER);
    this.finalProgram = createProgram(this.gl, FINAL_FRAGMENT_SHADER);
    this.vao = required(this.gl.createVertexArray(), 'Unable to create WebGL vertex array');
    this.sourceTexture = createTexture(this.gl);
    this.filteredTexture = createTexture(this.gl);
    this.curveTexture = createTexture(this.gl);
    this.framebuffer = required(this.gl.createFramebuffer(), 'Unable to create WebGL framebuffer');
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.unusable = true;
    });
  }

  private assertHealthy(stage: string): void {
    const error = this.gl.getError();
    if (error !== this.gl.NO_ERROR) throw new WebGLRendererError(`WebGL error ${error} during ${stage}`);
  }

  render(image: RenderableImage, params: FilterParams, intensity = 1): RenderableImage {
    if (this.disposed) throw new WebGLRendererError('WebGL renderer is disposed');
    if (this.unusable || this.gl.isContextLost()) throw new WebGLRendererError('WebGL context is lost');
    if (image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) {
      throw new WebGLRendererError('Renderable image dimensions do not match its RGBA data');
    }

    const gl = this.gl;
    const packed = packWebGLParams(params, intensity);
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    gl.viewport(0, 0, image.width, image.height);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      image.width,
      image.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image.data,
    );

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 257, 1, 0, gl.RED, gl.FLOAT, packed.curve);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.filteredTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, image.width, image.height, 0, gl.RGBA, gl.FLOAT, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.filteredTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new WebGLRendererError('WebGL filtered framebuffer is incomplete');
    }
    this.assertHealthy('texture allocation');

    gl.bindVertexArray(this.vao);
    gl.useProgram(this.filterProgram);
    gl.uniform1i(uniform(gl, this.filterProgram, 'uInput'), 0);
    gl.uniform1i(uniform(gl, this.filterProgram, 'uCurve'), 1);
    gl.uniform1f(uniform(gl, this.filterProgram, 'uSaturation'), packed.saturation);
    gl.uniform1f(uniform(gl, this.filterProgram, 'uHueDegrees'), packed.hueDegrees);
    gl.uniform1i(uniform(gl, this.filterProgram, 'uMonochrome'), packed.monochrome);
    gl.uniform3fv(uniform(gl, this.filterProgram, 'uMonoWeights'), packed.monoWeights);
    gl.uniform1i(uniform(gl, this.filterProgram, 'uHasToning'), packed.hasToning);
    gl.uniform3fv(uniform(gl, this.filterProgram, 'uToningColor'), packed.toningColor);
    gl.uniform1f(uniform(gl, this.filterProgram, 'uToningMix'), packed.toningMix);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.assertHealthy('filter pass');

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.finalProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.filteredTexture);
    gl.uniform1i(uniform(gl, this.finalProgram, 'uOriginal'), 0);
    gl.uniform1i(uniform(gl, this.finalProgram, 'uFiltered'), 2);
    gl.uniform2i(uniform(gl, this.finalProgram, 'uImageSize'), image.width, image.height);
    gl.uniform1f(uniform(gl, this.finalProgram, 'uSharpeningAmount'), packed.sharpeningAmount);
    gl.uniform1f(uniform(gl, this.finalProgram, 'uIntensity'), packed.intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.assertHealthy('final pass');

    const bytes = new Uint8Array(image.data.length);
    gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    this.assertHealthy('readback');
    return {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(bytes.buffer),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.curveTexture);
    gl.deleteTexture(this.filteredTexture);
    gl.deleteTexture(this.sourceTexture);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.finalProgram);
    gl.deleteProgram(this.filterProgram);
  }
}

export function createWebGLRenderer(options: WebGLRendererOptions = {}): ImageRenderer {
  return new WebGLRenderer(options.canvasFactory ?? defaultCanvasFactory);
}

export function createBrowserRenderer(
  options: WebGLRendererOptions & { onFallback?: (error: unknown) => void } = {},
): ImageRenderer {
  try {
    return createFallbackRenderer(createWebGLRenderer(options), canvasRenderer, options.onFallback);
  } catch (error) {
    options.onFallback?.(error);
    return canvasRenderer;
  }
}

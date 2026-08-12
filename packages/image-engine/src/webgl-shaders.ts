export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}
`;

export const FILTER_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uInput;
uniform sampler2D uCurve;
uniform float uSaturation;
uniform float uHueDegrees;
uniform int uMonochrome;
uniform vec3 uMonoWeights;
uniform int uHasToning;
uniform vec3 uToningColor;
uniform float uToningMix;

out vec4 outColor;

float curveAt(float value) {
  float x = clamp(value, 0.0, 1.0) * 256.0;
  int lower = int(floor(x));
  if (lower >= 256) return texelFetch(uCurve, ivec2(256, 0), 0).r;
  float a = texelFetch(uCurve, ivec2(lower, 0), 0).r;
  float b = texelFetch(uCurve, ivec2(lower + 1, 0), 0).r;
  return mix(a, b, x - float(lower));
}

vec3 rgbToHsl(vec3 rgb) {
  float maximum = max(rgb.r, max(rgb.g, rgb.b));
  float minimum = min(rgb.r, min(rgb.g, rgb.b));
  float lightness = (maximum + minimum) * 0.5;
  float delta = maximum - minimum;
  if (delta == 0.0) return vec3(0.0, 0.0, lightness);
  float saturation = lightness > 0.5
    ? delta / (2.0 - maximum - minimum)
    : delta / (maximum + minimum);
  float hue;
  if (maximum == rgb.r) {
    hue = (rgb.g - rgb.b) / delta + (rgb.g < rgb.b ? 6.0 : 0.0);
  } else if (maximum == rgb.g) {
    hue = (rgb.b - rgb.r) / delta + 2.0;
  } else {
    hue = (rgb.r - rgb.g) / delta + 4.0;
  }
  return vec3(hue / 6.0, saturation, lightness);
}

float hueToRgb(float p, float q, float value) {
  float t = value;
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5
    ? hsl.z * (1.0 + hsl.y)
    : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hueToRgb(p, q, hsl.x + 1.0 / 3.0),
    hueToRgb(p, q, hsl.x),
    hueToRgb(p, q, hsl.x - 1.0 / 3.0)
  );
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 source = texelFetch(uInput, pixel, 0);
  vec3 rgb = vec3(curveAt(source.r), curveAt(source.g), curveAt(source.b));

  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  float saturationFactor = 1.0 + uSaturation * 0.1;
  rgb = vec3(luma) + (rgb - vec3(luma)) * saturationFactor;

  if (uHueDegrees != 0.0) {
    vec3 hsl = rgbToHsl(rgb);
    if (hsl.y != 0.0) {
      hsl.x = mod(hsl.x + uHueDegrees / 360.0, 1.0);
      if (hsl.x < 0.0) hsl.x += 1.0;
      rgb = hslToRgb(hsl);
    }
  }

  if (uMonochrome == 1) {
    float gray = dot(rgb, uMonoWeights);
    rgb = vec3(gray);
    if (uHasToning == 1) rgb = mix(rgb, uToningColor, uToningMix);
  }

  outColor = vec4(rgb, source.a);
}
`;

export const FINAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uOriginal;
uniform sampler2D uFiltered;
uniform ivec2 uImageSize;
uniform float uSharpeningAmount;
uniform float uIntensity;

out vec4 outColor;

vec3 filteredAt(ivec2 pixel) {
  ivec2 bounded = clamp(pixel, ivec2(0), uImageSize - ivec2(1));
  return texelFetch(uFiltered, bounded, 0).rgb;
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 original = texelFetch(uOriginal, pixel, 0);
  vec3 center = filteredAt(pixel);
  vec3 blur = (
    filteredAt(pixel + ivec2(-1, -1)) +
    filteredAt(pixel + ivec2( 0, -1)) +
    filteredAt(pixel + ivec2( 1, -1)) +
    filteredAt(pixel + ivec2(-1,  0)) +
    center +
    filteredAt(pixel + ivec2( 1,  0)) +
    filteredAt(pixel + ivec2(-1,  1)) +
    filteredAt(pixel + ivec2( 0,  1)) +
    filteredAt(pixel + ivec2( 1,  1))
  ) / 9.0;
  vec3 detail = clamp(center - blur, vec3(-0.5), vec3(0.5));
  vec3 sharpened = clamp(center + uSharpeningAmount * detail, 0.0, 1.0);
  vec3 rgb = mix(original.rgb, sharpened, clamp(uIntensity, 0.0, 1.0));
  outColor = vec4(rgb, original.a);
}
`;

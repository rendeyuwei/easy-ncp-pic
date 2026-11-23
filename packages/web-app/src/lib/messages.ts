import type { AppErrorCode } from './app-error';
import type { AppLang } from './locale';

export interface Messages {
  readonly uploadTitle: string;
  readonly uploadIntro: string;
  readonly uploadAria: string;
  readonly dropRelease: string;
  readonly dropIdle: string;
  readonly dropHint: string;
  readonly fileInput: string;
  readonly privacyUpload: string;
  readonly selected: string;
  readonly opening: string;
  readonly themeToLight: string;
  readonly themeToDark: string;
  readonly homeAria: string;
  readonly privacyPill: string;
  readonly currentLook: string;
  readonly chooseFilter: string;
  readonly applying: string;
  readonly processing: string;
  readonly replaceTitle: string;
  readonly replaceDescription: string;
  readonly keepEditing: string;
  readonly confirmReplace: string;
  readonly adjustments: string;
  readonly intensity: string;
  readonly holdOriginal: string;
  readonly replacePhoto: string;
  readonly exportAction: string;
  readonly exportTitle: string;
  readonly exportLead: string;
  readonly exportPixels: string;
  readonly formatLegend: string;
  readonly jpg: string;
  readonly quality: string;
  readonly png: string;
  readonly lossless: string;
  readonly exportingProgress: string;
  readonly cancel: string;
  readonly exporting: string;
  readonly exportPhoto: string;
  readonly noFilters: string;
  readonly filters: string;
  readonly filterCategories: string;
  readonly filterPreview: string;
  readonly generatingPreview: string;
  readonly noPreview: string;
  readonly applyingShort: string;
  readonly compareFigure: string;
  readonly original: string;
  readonly filteredEffect: string;
  readonly compareSlider: string;
  readonly compareValue: string;
  readonly filterLabel: string;
  readonly close: string;
  readonly compareKeys: string;
  readonly description: string;
  readonly noscript: string;
  readonly errors: Record<AppErrorCode, string>;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z0-9]+)\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

const zh = {
  uploadTitle: '让照片呈现你想要的质感',
  uploadIntro: '选择一张照片，在浏览器里预览并应用精选滤镜。',
  uploadAria: '上传照片',
  dropRelease: '松开即可打开照片',
  dropIdle: '点击或拖放照片到这里',
  dropHint: '支持 JPG、PNG，一次一张',
  fileInput: '选择一张照片',
  privacyUpload: '照片不会上传服务器',
  selected: '已选择：{name}',
  opening: '正在打开照片 {percent}%',
  themeToLight: '切换到浅色主题',
  themeToDark: '切换到深色主题',
  homeAria: 'EasyPic 首页',
  privacyPill: '照片仅在本机处理',
  currentLook: '当前效果',
  chooseFilter: '选择一个滤镜',
  applying: '正在应用 {name}…',
  processing: '正在处理照片…',
  replaceTitle: '更换照片？',
  replaceDescription: '当前滤镜和强度设置会被清除。',
  keepEditing: '继续编辑',
  confirmReplace: '确认更换',
  adjustments: '照片调整',
  intensity: '滤镜强度',
  holdOriginal: '按住看原图',
  replacePhoto: '更换照片',
  exportAction: '导出',
  exportTitle: '导出照片',
  exportLead: '按原始尺寸导出 ·',
  exportPixels: '{width} × {height} 像素',
  formatLegend: '文件格式',
  jpg: 'JPG',
  quality: '质量 92%',
  png: 'PNG',
  lossless: '无损',
  exportingProgress: '正在导出 {percent}%',
  cancel: '取消',
  exporting: '正在导出…',
  exportPhoto: '导出照片',
  noFilters: '暂无可用滤镜',
  filters: '滤镜',
  filterCategories: '滤镜分类',
  filterPreview: '{name} 滤镜预览',
  generatingPreview: '正在生成预览',
  noPreview: '暂无预览',
  applyingShort: '正在应用',
  compareFigure: '照片滤镜预览',
  original: '原图',
  filteredEffect: '滤镜效果',
  compareSlider: '原图与滤镜对比',
  compareValue: '原图 {percent}%',
  filterLabel: '滤镜',
  close: '关闭',
  compareKeys: '用左右方向键移动分隔线，Home 与 End 跳到两端。',
  description: 'EasyPic — 在浏览器中为照片应用精选滤镜。',
  noscript: '请启用 JavaScript 后使用 EasyPic。',
  errors: {
    'filters-unavailable': '滤镜暂时无法加载，请稍后重试。',
    'filters-stale': '滤镜列表暂时无法更新，请稍后重试。',
    'file-count': '一次只能处理一张照片。',
    'file-type': '请选择 JPG 或 PNG 照片。',
    'file-unreadable': '无法读取这张照片，请确认文件是有效的 JPG 或 PNG。',
    'dimension-side': '照片尺寸过大，请选择边长不超过 10000 像素的照片。',
    'dimension-total': '照片尺寸过大，请选择不超过 8000 万总像素的照片。',
    'worker-start': '图片处理线程启动失败，请刷新页面后重试。',
    'render-failed': '滤镜预览失败，请选择其他滤镜或重试。',
    'export-failed': '导出失败。编辑状态已保留，请重试。',
    'export-in-progress': '已有导出任务正在进行。',
    'export-no-filter': '请先选择一个滤镜。',
    'webgl-fallback': 'WebGL 不可用，已切换到兼容模式，处理速度可能较慢。',
  },
} satisfies Messages;

const en = {
  uploadTitle: 'Give the photo the look you want',
  uploadIntro: 'Choose a photo, then preview curated filters in the browser.',
  uploadAria: 'Upload a photo',
  dropRelease: 'Release to open the photo',
  dropIdle: 'Click or drop a photo here',
  dropHint: 'JPG or PNG, one at a time',
  fileInput: 'Choose a photo',
  privacyUpload: 'Photos are not uploaded',
  selected: 'Selected: {name}',
  opening: 'Opening photo {percent}%',
  themeToLight: 'Switch to light theme',
  themeToDark: 'Switch to dark theme',
  homeAria: 'EasyPic home',
  privacyPill: 'Processed only on this device',
  currentLook: 'Current look',
  chooseFilter: 'Choose a filter',
  applying: 'Applying {name}…',
  processing: 'Processing photo…',
  replaceTitle: 'Change photo?',
  replaceDescription: 'The current filter and strength will be cleared.',
  keepEditing: 'Keep editing',
  confirmReplace: 'Change photo',
  adjustments: 'Photo adjustments',
  intensity: 'Filter strength',
  holdOriginal: 'Hold for the original',
  replacePhoto: 'Change photo',
  exportAction: 'Export',
  exportTitle: 'Export photo',
  exportLead: 'Export at the original size ·',
  exportPixels: '{width} × {height} px',
  formatLegend: 'File format',
  jpg: 'JPG',
  quality: 'Quality 92%',
  png: 'PNG',
  lossless: 'Lossless',
  exportingProgress: 'Exporting {percent}%',
  cancel: 'Cancel',
  exporting: 'Exporting…',
  exportPhoto: 'Export photo',
  noFilters: 'No filters available',
  filters: 'Filters',
  filterCategories: 'Filter categories',
  filterPreview: '{name} filter preview',
  generatingPreview: 'Generating preview',
  noPreview: 'No preview',
  applyingShort: 'Applying',
  compareFigure: 'Photo filter preview',
  original: 'Original',
  filteredEffect: 'Filtered photo',
  compareSlider: 'Compare original and filter',
  compareValue: 'Original {percent}%',
  filterLabel: 'Filter',
  close: 'Close',
  compareKeys: 'Use the arrow keys to move the divider. Home and End jump to either end.',
  description: 'EasyPic — preview curated filters on a photo in your browser.',
  noscript: 'Enable JavaScript to use EasyPic.',
  errors: {
    'filters-unavailable': 'Filters are unavailable right now. Try again later.',
    'filters-stale': 'The filter list could not be refreshed. Try again later.',
    'file-count': 'Only one photo can be opened at a time.',
    'file-type': 'Choose a JPG or PNG photo.',
    'file-unreadable': 'This photo could not be read. Check that it is a valid JPG or PNG.',
    'dimension-side': 'This photo is too large. Choose one whose longest side is at most 10,000 pixels.',
    'dimension-total': 'This photo is too large. Choose one with at most 80 million pixels.',
    'worker-start': 'The image processor failed to start. Refresh the page and try again.',
    'render-failed': 'The filter preview failed. Choose another filter or try again.',
    'export-failed': 'Export failed. Your edits are still here. Try again.',
    'export-in-progress': 'An export is already running.',
    'export-no-filter': 'Choose a filter first.',
    'webgl-fallback': 'WebGL is unavailable, so compatibility mode is on. Processing may be slower.',
  },
} satisfies Messages;

export const messages: Record<AppLang, Messages> = { zh, en };

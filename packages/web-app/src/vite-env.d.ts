/// <reference types="vite/client" />

interface Navigator {
  readonly deviceMemory?: number;
}

interface Window {
  rfLang?: {
    v: number;
    leaving: boolean;
    enter(): void;
    choose?(lang: 'zh' | 'en'): boolean;
  };
  __easypicLeaving?: boolean;
  __rfBar?: number;
}

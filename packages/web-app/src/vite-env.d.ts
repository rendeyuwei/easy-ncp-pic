/// <reference types="vite/client" />

interface Navigator {
  readonly deviceMemory?: number;
}

interface Window {
  rfLang?: {
    v: number;
    leaving: boolean;
    enter(): void;
  };
  __easypicLeaving?: boolean;
}

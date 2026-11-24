import type { WidgetApi } from '../shared/ipc';

declare global {
  interface Window {
    kubo: WidgetApi;
  }
}

declare module '*.css';

export {};

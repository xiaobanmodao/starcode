import type { StarCodeApi } from '../shared/contracts';

declare global {
  interface Window {
    starcode: StarCodeApi;
  }
}

export {};

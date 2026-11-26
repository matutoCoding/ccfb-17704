import type { SceneApp } from '../three/SceneApp';

export interface Ctx {
  app: SceneApp;
  toast: (msg: string) => void;
  rerender: () => void;
  addCleanup: (fn: () => void) => void;
  beginPlace: (type: string, params?: Record<string, number>) => void;
  triggerImport: () => void;
  exportTerrain: () => void;
  playPov: (featureId: string) => void;
  loadPlanById: (id: string) => Promise<void> | void;
  saveCurrentAs: (name: string) => Promise<void> | void;
}

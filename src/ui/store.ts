import type { PageId, Plan } from '../core/types';
import { createPlanA, clonePlan } from '../core/samplePlans';
import { evaluateCourse, type CourseReport } from '../core/course';
import { idbSavePlan } from '../core/db';

export interface ViewSettings {
  lighting: 'sun' | 'flat';
  flatAmount: number;
  heatmap: boolean;
  contours: boolean;
  groomArrows: boolean;
  corduroy: boolean;
  glitter: boolean;
}

type EventName = 'page' | 'selection' | 'plan' | 'view' | 'fps';

class Store {
  // 工作副本使用独立 id，自动保存不会覆盖 IndexedDB 中的内置 A/B 基准
  plan: Plan = clonePlan(createPlanA(), 'current', '当前方案 · 初版（落点不足）');
  page: PageId = 'park';
  selectedId: string | null = this.plan.order[2] ?? this.plan.features[0]?.id ?? null;
  selectedJumpId: string | null = this.plan.features.find((f) => f.kind === 'jump')?.id ?? null;
  report: CourseReport = evaluateCourse(this.plan);
  fps = 0;
  saveState: 'saved' | 'saving' | 'dirty' = 'dirty';
  view: ViewSettings = {
    lighting: 'sun',
    flatAmount: 0.85,
    heatmap: false,
    contours: false,
    groomArrows: true,
    corduroy: true,
    glitter: true,
  };

  private listeners = new Map<EventName, Set<() => void>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  on(evt: EventName, fn: () => void): () => void {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt)!.add(fn);
    return () => this.listeners.get(evt)?.delete(fn);
  }
  private emit(evt: EventName): void {
    this.listeners.get(evt)?.forEach((fn) => fn());
  }

  setPage(p: PageId): void {
    this.page = p;
    this.emit('page');
  }

  select(id: string | null): void {
    this.selectedId = id;
    if (id && this.plan.features.find((f) => f.id === id)?.kind === 'jump') {
      this.selectedJumpId = id;
    }
    this.emit('selection');
  }

  setFps(n: number): void {
    this.fps = n;
    this.emit('fps');
  }

  setView(patch: Partial<ViewSettings>): void {
    Object.assign(this.view, patch);
    this.emit('view');
  }

  /** 修改方案：重算安全报告、同步 3D、防抖写 IndexedDB */
  mutate(fn: (p: Plan) => void, opts: { skipReport?: boolean } = {}): void {
    fn(this.plan);
    if (!opts.skipReport) this.report = evaluateCourse(this.plan);
    this.saveState = 'dirty';
    this.emit('plan');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 700);
  }

  async saveNow(): Promise<void> {
    this.saveState = 'saving';
    try {
      await idbSavePlan(this.plan);
      this.saveState = 'saved';
    } catch (e) {
      console.warn('IndexedDB 保存失败', e);
      this.saveState = 'dirty';
    }
  }

  loadPlan(p: Plan): void {
    this.plan = p;
    this.report = evaluateCourse(p);
    this.selectedId = p.order[0] ?? p.features[0]?.id ?? null;
    this.selectedJumpId = p.features.find((f) => f.kind === 'jump')?.id ?? null;
    this.saveState = 'saved';
    this.emit('plan');
    this.emit('selection');
  }
}

export const store = new Store();

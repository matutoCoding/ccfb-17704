// 极简 DOM 构造辅助
export type ElChild = Node | string | number | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & {
    class?: string;
    style?: string | Partial<CSSStyleDeclaration>;
    dataset?: Record<string, string>;
  },
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'string') el.style.cssText = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v as Record<string, string>)) el.dataset[dk] = dv;
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'value' && el instanceof HTMLInputElement) {
        el.value = String(v);
      } else {
        (el as any)[k] = v;
      }
    }
  }
  for (const c of children) {
    if (c === false || c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

export function badge(text: string, level: 'ok' | 'warn' | 'bad' | 'info' = 'info'): HTMLSpanElement {
  return h('span', { class: `badge badge-${level}` }, text);
}

/** 带标签的滑块行，input 事件实时回调 */
export function sliderRow(opts: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onInput: (v: number) => void;
  format?: (v: number) => string;
}): HTMLLabelElement {
  const val = h(
    'span',
    { class: 'ctrl-value' },
    opts.format ? opts.format(opts.value) : `${opts.value}${opts.unit ?? ''}`,
  );
  const input = h('input', {
    type: 'range',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step),
    value: String(opts.value),
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = opts.format ? opts.format(v) : `${v}${opts.unit ?? ''}`;
    opts.onInput(v);
  });
  return h(
    'label',
    { class: 'ctrl-slider' },
    h('span', { class: 'ctrl-label' }, opts.label),
    input,
    val,
  );
}

export function button(
  text: string,
  onClick: () => void,
  variant: 'default' | 'primary' | 'danger' | 'ghost' = 'default',
): HTMLButtonElement {
  return h('button', { class: `btn btn-${variant}`, onclick: onClick }, text);
}

export function statCard(label: string, value: string, sub?: string, tone?: LevelTone): HTMLElement {
  return h(
    'div',
    { class: `stat-card ${tone ? `tone-${tone}` : ''}` },
    h('div', { class: 'stat-value' }, value),
    h('div', { class: 'stat-label' }, label),
    sub ? h('div', { class: 'stat-sub' }, sub) : null,
  );
}

export type LevelTone = 'ok' | 'warn' | 'bad';

export function levelText(l: 'ok' | 'warn' | 'bad'): string {
  return l === 'ok' ? '合格' : l === 'warn' ? '注意' : '不合格';
}

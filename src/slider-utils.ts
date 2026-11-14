import { isFiniteNumeric, normalizeNumericValue, type NumericDomain } from './numeric-domain';

/** Shared slider UX utilities: click-to-edit value labels, double-click-to-reset. */

/** Format a slider value with as many decimals as its step needs (at least 2 for fractional
 *  steps). A fixed 2 decimals showed a 0.035 in thickness (step 0.005) as "0.04". */
export function formatSliderValue(value: number, step: number): string {
  // Integer steps can still carry a fractional value (a relief master's 6.000000000000001 in from
  // metres): print at most 3 decimals, and none for whole numbers.
  if (Number.isInteger(step)) return String(Number(value.toFixed(3)));
  const dot = String(step).indexOf('.');
  const stepDecimals = dot < 0 ? 0 : String(step).length - dot - 1;
  return value.toFixed(Math.min(4, Math.max(2, stepDecimals)));
}

interface RangeSettings {
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  readOnly?: boolean;
  domain?: NumericDomain;
}
interface RangeUpdate {
  min?: number;
  max?: number;
  defaultValue?: number;
}
const ranges = new WeakMap<HTMLInputElement, { label: HTMLElement; step: number; probe: HTMLInputElement; readOnly: boolean; domain?: NumericDomain; value: number; nativeValue: string }>();

function clampRange(input: HTMLInputElement, value: number): number {
  return normalizeNumericValue(value, Number(input.min), Number(input.max), ranges.get(input)?.domain);
}

function formatRangeValue(value: number, step: number): string {
  const formatted = formatSliderValue(value, step);
  return Number(formatted) === value ? formatted : String(value);
}

/** Every range retains its nominal increment independently of native precision. */
export function configureRange(input: HTMLInputElement, label: HTMLElement, settings: RangeSettings): void {
  if (!(Number.isFinite(settings.step) && settings.step > 0)) throw new Error('Range increment must be positive');
  const configured = ranges.get(input);
  input.type = 'range';
  input.disabled = settings.readOnly ?? false;
  ranges.set(input, { label, step: settings.step, probe: configured?.probe ?? input.cloneNode(false) as HTMLInputElement, readOnly: input.disabled, domain: settings.domain, value: settings.value, nativeValue: '' });
  input.dataset.step = String(settings.step);
  if (settings.domain) input.dataset.quantum = String(settings.domain.quantum);
  syncRange(input, settings.value, settings);
  if (configured) return;
  input.addEventListener('keydown', event => {
    if (input.step !== 'any' || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = ranges.get(input)!.step;
    const directions: Record<string, number | undefined> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    const direction = directions[event.key];
    let value: number;
    if (event.key === 'Home') value = Number(input.min);
    else if (event.key === 'End') value = Number(input.max);
    else if (direction !== undefined) {
      const current = readRangeValue(input);
      const decimals = (n: number): number => {
        const [coefficient, exponent = '0'] = String(n).split('e');
        return Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - Number(exponent));
      };
      value = Number((current + direction * step).toFixed(Math.min(15, Math.max(decimals(current), decimals(step)))));
    } else return;
    event.preventDefault();
    const previous = readRangeValue(input);
    if (syncRange(input, value) === previous) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** One path applies bounds, preserves current/default precision and synchronizes the label. */
export function syncRange(input: HTMLInputElement, value: number, update: RangeUpdate = {}): number {
  const range = ranges.get(input);
  if (!range) throw new Error(`Range ${input.id} is not configured`);
  let min = update.min ?? Number(input.min), max = update.max ?? Number(input.max);
  if (range.readOnly) { min = Math.min(min, value); max = Math.max(max, value); }
  const defaultValue = update.defaultValue ?? Number(input.dataset.default);
  if (![min, max, value, defaultValue].every(isFiniteNumeric) || min > max) throw new Error(`Invalid range ${input.id}`);
  input.step = 'any';
  input.min = String(min);
  input.max = String(max);
  input.dataset.default = String(defaultValue);
  const current = clampRange(input, value), reset = clampRange(input, defaultValue);
  // A detached native range checks quantization without changing the live value or duplicating tie rules.
  range.probe.min = String(min);
  range.probe.max = String(max);
  range.probe.step = String(range.step);
  const represents = (candidate: number): boolean => {
    range.probe.value = String(candidate);
    return Number(range.probe.value) === candidate;
  };
  input.step = represents(max) && represents(reset) && represents(current) ? String(range.step) : 'any';
  input.value = String(current);
  range.value = current;
  range.nativeValue = input.value;
  input.dataset.value = String(current);
  range.label.textContent = formatRangeValue(current, range.step);
  if (input.isConnected) {
    const button = document.getElementById(`reset_${input.id}`);
    if (button instanceof HTMLButtonElement) updateResetVisibility(button, input);
  }
  return current;
}

/** Range thumb strings can lose IEEE-754 digits even with step=any. Keep the exact model value
 *  for synchronized/editor writes; a changed native string represents a new slider gesture. */
export function readRangeValue(input: HTMLInputElement): number {
  const range = ranges.get(input);
  if (!range) throw new Error(`Range ${input.id} is not configured`);
  return clampRange(input, input.value === range.nativeValue ? range.value : Number(input.value));
}

/** Attach click-to-edit behavior on a value span + slider pair. */
export function attachValueEdit(valSpan: HTMLElement, sl: HTMLInputElement): void {
  if (sl.disabled) return;
  valSpan.classList.add('editable-value');
  valSpan.title = 'Click to type a value';
  valSpan.addEventListener('click', () => {
    if (sl.disabled || valSpan.querySelector('input')) return;
    const current = valSpan.textContent ?? '';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = current;
    inp.className = 'val-edit';
    valSpan.textContent = '';
    valSpan.appendChild(inp);
    inp.focus();
    inp.select();

    let cancelled = false;
    const commit = (): void => {
      if (cancelled) return;
      if (inp.value === current) { cancelled = true; valSpan.textContent = current; return; }
      const n = inp.value.trim() ? Number(inp.value) : NaN;
      cancelled = true;
      if (Number.isFinite(n)) {
        syncRange(sl, n);
        sl.dispatchEvent(new Event('input', { bubbles: true }));
      } else valSpan.textContent = current;
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelled = true; valSpan.textContent = current; }
    });
    inp.addEventListener('blur', commit);
  });
}

/** Keep the existing double-click reset path available on touch and keyboard. */
export function attachControlReset(control: HTMLInputElement | HTMLSelectElement): void {
  if (control.dataset.default === undefined) return;
  const label = control.closest('.control-row')?.querySelector('.control-label');
  if (!label || label.querySelector('.control-reset')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'control-reset';
  button.id = `reset_${control.id}`;
  button.textContent = 'Reset';
  button.dataset.resetFor = control.id;
  button.setAttribute('aria-label', `Reset ${label.firstElementChild?.textContent ?? label.textContent ?? 'control'}`);
  button.addEventListener('click', () => {
    control.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    refreshControlResets();
  });
  label.appendChild(button);
  control.addEventListener('input', refreshControlResets);
  control.addEventListener('change', refreshControlResets);
  refreshControlResets();
}

function updateResetVisibility(button: HTMLButtonElement, control: HTMLInputElement | HTMLSelectElement): void {
  const current = control.value;
  const defaultValue = control.dataset.default;
  let same = current === defaultValue;
  if (control instanceof HTMLInputElement && control.type === 'range') {
    const effectiveDefault = clampRange(control, Number(defaultValue));
    same = readRangeValue(control) === effectiveDefault;
  }
  button.hidden = same || control.disabled;
}

export function refreshControlResets(): void {
  if (!document.getElementById('controlsPane')) return;
  document.querySelectorAll<HTMLButtonElement>('.control-reset').forEach(button => {
    const control = document.getElementById(button.dataset.resetFor ?? '');
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) updateResetVisibility(button, control);
  });
}

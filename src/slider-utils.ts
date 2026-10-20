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

/** Attach click-to-edit behavior on a value span + slider pair. */
export function attachValueEdit(valSpan: HTMLElement, sl: HTMLInputElement): void {
  valSpan.style.cursor = 'pointer';
  valSpan.title = 'Click to type a value';
  valSpan.addEventListener('click', () => {
    if (valSpan.querySelector('input')) return;
    const current = valSpan.textContent ?? '';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = current;
    inp.className = 'val-edit';
    inp.style.width = '50px';
    inp.style.fontSize = '11px';
    inp.style.fontFamily = 'var(--mono)';
    inp.style.color = 'var(--accent)';
    inp.style.background = 'var(--bg3)';
    inp.style.border = '1px solid var(--accent)';
    inp.style.borderRadius = '2px';
    inp.style.textAlign = 'right';
    inp.style.padding = '0 2px';
    valSpan.textContent = '';
    valSpan.appendChild(inp);
    inp.focus();
    inp.select();

    let cancelled = false;
    const commit = (): void => {
      if (cancelled) return;
      const n = parseFloat(inp.value);
      if (!isNaN(n)) {
        const step = parseFloat(sl.step) || 1;
        const snapped = Math.round(n / step) * step;
        const clamped = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), snapped));
        sl.value = String(clamped);
        sl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        valSpan.textContent = current;
      }
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelled = true; valSpan.textContent = current; }
    });
    inp.addEventListener('blur', commit);
  });
}

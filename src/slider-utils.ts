/** Shared slider UX utilities: click-to-edit value labels, double-click-to-reset. */

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
        const clamped = Math.max(parseFloat(sl.min), Math.min(parseFloat(sl.max), n));
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

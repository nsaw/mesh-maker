let _hideTimer: ReturnType<typeof setTimeout> | null = null;
let _finalizeTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  if (_hideTimer !== null) { clearTimeout(_hideTimer); _hideTimer = null; }
  if (_finalizeTimer !== null) { clearTimeout(_finalizeTimer); _finalizeTimer = null; }
  toast.textContent = message;
  toast.style.display = 'block';
  toast.classList.add('visible');
  _hideTimer = setTimeout(() => {
    toast.classList.remove('visible');
    _finalizeTimer = setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 1500);
}

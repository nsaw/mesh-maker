let hideTimer: ReturnType<typeof setTimeout> | null = null;
let finalizeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a transient toast message in the fixed bottom toast element.
 * @param message - Text to display.
 * @param duration - How long to show (ms); default 1500. After this, toast fades out then hides after 300ms.
 */
export function showToast(message: string, duration = 1500): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (finalizeTimer !== null) {
    clearTimeout(finalizeTimer);
    finalizeTimer = null;
  }
  toast.textContent = message;
  toast.style.display = 'block';
  toast.classList.add('visible');
  hideTimer = setTimeout(() => {
    toast.classList.remove('visible');
    finalizeTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 300);
  }, duration);
}

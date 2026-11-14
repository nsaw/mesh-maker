import { showSidebarPane } from './sidebar-state';

export function setupSponsors(): void {
  const images = [
    'https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/ef64f44c-42cc-451d-f1de-b51229a45600/w=800',
    'https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/b657c94b-f67c-4a12-9b3d-64930c5e5900/w=800',
  ];
  let imageIndex = 0;
  const image = document.getElementById('sponsorImg') as HTMLImageElement;
  document.getElementById('btnSponsors')!.addEventListener('click', () => showSidebarPane('sponsors'));
  document.getElementById('btnSponsorsBack')!.addEventListener('click', () => showSidebarPane('controls'));
  for (const [id, delta] of [['sponsorPrev', -1], ['sponsorNext', 1]] as const) {
    document.getElementById(id)!.addEventListener('click', () => {
      imageIndex = (imageIndex + delta + images.length) % images.length;
      image.src = images[imageIndex];
    });
  }

  // Scroll-to-export button — uses static arrow characters only (no user input)
  const scrollBtn = document.getElementById('scrollExportBtn')!;
  let atBottom = false;
  const ARROW_DOWN = '\u2193';
  const ARROW_UP = '\u2191';

  let paddingResetTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollDelayTimer: ReturnType<typeof setTimeout> | null = null;

  scrollBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (atBottom) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const bar = document.querySelector('.export-bar');
      if (!bar) return;
      const barRect = bar.getBoundingClientRect();
      const scrollTarget = window.scrollY + barRect.bottom - window.innerHeight + 20;
      if (scrollTarget <= window.scrollY) {
        if (paddingResetTimer !== null) clearTimeout(paddingResetTimer);
        if (scrollDelayTimer !== null) clearTimeout(scrollDelayTimer);
        document.body.style.paddingBottom = barRect.height + 40 + 'px';
        scrollDelayTimer = setTimeout(() => {
          scrollDelayTimer = null;
          window.scrollTo({ top: document.body.scrollHeight - window.innerHeight, behavior: 'smooth' });
        }, 10);
        paddingResetTimer = setTimeout(() => {
          document.body.style.paddingBottom = '';
          paddingResetTimer = null;
        }, 600);
      } else {
        window.scrollTo({ top: scrollTarget, behavior: 'smooth' });
      }
    }
  });

  window.addEventListener('scroll', () => {
    const scrolledToBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 20);
    if (scrolledToBottom) {
      atBottom = true;
      scrollBtn.textContent = ARROW_UP;
      if (paddingResetTimer !== null) { clearTimeout(paddingResetTimer); paddingResetTimer = null; }
      document.body.style.paddingBottom = '';
    } else {
      atBottom = false;
      scrollBtn.textContent = ARROW_DOWN;
    }
  });
}

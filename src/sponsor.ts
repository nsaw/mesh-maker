export function setupSponsorModal(): void {
  const SPONSOR_IMGS: readonly string[] = [
    'https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/ef64f44c-42cc-451d-f1de-b51229a45600/w=800',
    'https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/04acb407-564f-4b6e-8c91-9506c2f52300/w=800',
  ];
  let sponsorIdx = 0;
  const backdrop = document.getElementById('sponsorBackdrop')!;
  const sImg = document.getElementById('sponsorImg') as HTMLImageElement;

  function showSponsor(): void { backdrop.classList.add('visible'); }
  function hideSponsor(): void { backdrop.classList.remove('visible'); }

  document.getElementById('sponsorClose')!.addEventListener('click', hideSponsor);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) hideSponsor(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSponsor(); });

  document.getElementById('sponsorPrev')!.addEventListener('click', () => {
    sponsorIdx = (sponsorIdx - 1 + SPONSOR_IMGS.length) % SPONSOR_IMGS.length;
    sImg.src = SPONSOR_IMGS[sponsorIdx];
  });
  document.getElementById('sponsorNext')!.addEventListener('click', () => {
    sponsorIdx = (sponsorIdx + 1) % SPONSOR_IMGS.length;
    sImg.src = SPONSOR_IMGS[sponsorIdx];
  });

  let sponsorTimeout: ReturnType<typeof setTimeout> | null = null;

  const sponsorBtn = document.getElementById('btnSponsor');
  if (sponsorBtn) sponsorBtn.addEventListener('click', () => {
    if (sponsorTimeout) { clearTimeout(sponsorTimeout); sponsorTimeout = null; }
    showSponsor();
  });

  if (!sessionStorage.getItem('sponsorSeen')) {
    sessionStorage.setItem('sponsorSeen', '1');
    sponsorTimeout = setTimeout(() => {
      sponsorTimeout = null;
      showSponsor();
    }, 4000);
  }

  // Bitsbits sponsor banner — slide-in drawer (right edge, 60s delay)
  setupBitsBitsBanner();

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

function setupBitsBitsBanner(): void {
  if (sessionStorage.getItem('bbBannerDismissed')) return;

  const BANNER_IMG = 'https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/7d4ecee6-c56f-4e09-dd49-c24553552900/w=400';
  const BANNER_URL = 'https://bitsbits.com';
  const DELAY_MS = 60_000;

  const backdrop = document.createElement('div');
  backdrop.className = 'bb-banner-backdrop';

  const banner = document.createElement('a');
  banner.className = 'bb-banner';
  banner.href = BANNER_URL;
  banner.target = '_blank';
  banner.rel = 'noopener';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'bb-banner-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00d7';

  const img = document.createElement('img');
  img.src = BANNER_IMG;
  img.alt = 'bitsbits.com';

  const label = document.createElement('div');
  label.className = 'bb-banner-label';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = 'Sponsor';
  label.appendChild(labelSpan);

  banner.appendChild(closeBtn);
  banner.appendChild(img);
  banner.appendChild(label);
  document.body.appendChild(backdrop);
  document.body.appendChild(banner);

  function show(): void {
    backdrop.classList.add('visible');
    banner.classList.add('visible');
  }

  function dismiss(): void {
    banner.classList.remove('visible');
    backdrop.classList.remove('visible');
    sessionStorage.setItem('bbBannerDismissed', '1');
  }

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  });

  backdrop.addEventListener('click', dismiss);

  setTimeout(show, DELAY_MS);
}

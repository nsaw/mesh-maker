type Pane = 'controls' | 'sponsors';
interface PaneView {
  scrollTop: number;
  focusId: string | null;
  editValue?: string;
}

let activePane: Pane = 'controls';
const views: Record<Pane, PaneView> = {
  controls: { scrollTop: 0, focusId: null },
  sponsors: { scrollTop: 0, focusId: null },
};
const sectionOpen = new Map<string, boolean>();
let sectionsInitialized = false;
const observedSidebars = new WeakSet<HTMLElement>();

export function captureSidebarView(completedEdit?: KeyboardEvent): boolean {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return false;
  if (!observedSidebars.has(sidebar)) {
    observedSidebars.add(sidebar);
    sidebar.addEventListener('focusin', () => { captureSidebarView(); });
    sidebar.addEventListener('input', () => { captureSidebarView(); });
    sidebar.addEventListener('keydown', event => { captureSidebarView(event); });
  }
  const view = views[activePane];
  view.scrollTop = sidebar.scrollTop;
  if (completedEdit?.target instanceof HTMLInputElement && completedEdit.target.classList.contains('val-edit')
    && (completedEdit.key === 'Enter' || completedEdit.key === 'Escape')) {
    const label = completedEdit.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('val'));
    view.focusId = label?.closest('.control-row')?.querySelector<HTMLInputElement>('input[type="range"]')?.id ?? null;
    view.editValue = undefined;
  }
  const focused = document.activeElement;
  const pane = document.getElementById(activePane === 'controls' ? 'controlsPane' : 'sponsorsPane');
  if (!(focused instanceof HTMLElement) || !pane?.contains(focused)) {
    const label = view.focusId ? document.getElementById(view.focusId) : null;
    if (view.editValue !== undefined && label?.classList.contains('val') && !label.querySelector('.val-edit')) {
      const draft = view.editValue.trim() ? Number(view.editValue) : NaN;
      // Valid navigation blur may reopen its committed editor; rejected/clamped text must not return.
      if (!Number.isFinite(draft) || draft !== Number(label.textContent)) {
        view.editValue = undefined;
        view.focusId = label.closest('.control-row')?.querySelector<HTMLInputElement>('input[type="range"]')?.id ?? null;
      }
    }
    return false;
  }
  view.focusId = focused.id || focused.closest<HTMLElement>('[id]')?.id || null;
  view.editValue = focused instanceof HTMLInputElement && focused.classList.contains('val-edit') ? focused.value : undefined;
  return true;
}

export function restoreSidebarView(focus = true): boolean {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return false;
  // Focusing a restored editor emits focusin and updates the live view; retain its saved draft.
  const view = { ...views[activePane] };
  let restored = false;
  if (focus && view.focusId) {
    const element = document.getElementById(view.focusId);
    if (element && !element.closest('[hidden]') && element.offsetParent !== null) {
      if (view.editValue !== undefined && element.classList.contains('val')) {
        element.click();
        const input = element.querySelector('input');
        if (input) { input.value = view.editValue; captureSidebarView(); }
      } else element.focus({ preventScroll: true });
      restored = document.activeElement === element || element.contains(document.activeElement);
    }
  }
  sidebar.scrollTop = view.scrollTop;
  return restored;
}

/** Sponsors is a pane, independent of the current generation mode. */
export function showSidebarPane(pane: Pane, focus = true): void {
  captureSidebarView();
  const changed = activePane !== pane;
  activePane = pane;
  const controls = document.getElementById('controlsPane');
  const sponsors = document.getElementById('sponsorsPane');
  if (controls) controls.hidden = pane !== 'controls';
  if (sponsors) sponsors.hidden = pane !== 'sponsors';
  const button = document.getElementById('btnSponsors');
  button?.classList.toggle('active', pane === 'sponsors');
  button?.setAttribute('aria-expanded', String(pane === 'sponsors'));
  restoreSidebarView(false);
  if (changed && focus) {
    if (pane === 'sponsors') document.getElementById('btnSponsorsBack')?.focus({ preventScroll: true });
    else {
      if (!restoreSidebarView()) document.getElementById('btnSponsors')?.focus({ preventScroll: true });
    }
  }
}

function sectionId(section: Element): string | null {
  return section.querySelector('.section-body')?.id || section.id || null;
}

function setSectionOpen(section: Element, open: boolean): void {
  section.classList.toggle('collapsed', !open);
  section.querySelector('.section-header')?.setAttribute('aria-expanded', String(open));
  const id = sectionId(section);
  if (id) sectionOpen.set(id, open);
}

/** Defaults run once. An empty set of open sections remains a deliberate state. */
export function restoreSections(root: Element): void {
  const sections = [...root.querySelectorAll('.section')];
  if (root.matches('.section')) sections.unshift(root);
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  let visibleOpen = false;
  for (const section of sections) {
    const id = sectionId(section);
    const saved = id ? sectionOpen.get(id) : undefined;
    const visible = (section as HTMLElement).offsetParent !== null;
    let open = saved ?? (mobile ? !sectionsInitialized && visible && !visibleOpen : !section.classList.contains('collapsed'));
    if (mobile && visible) {
      open = open && !visibleOpen;
      if (open) visibleOpen = true;
    }
    setSectionOpen(section, open);
  }
  sectionsInitialized = true;
}

export function wireSectionAccordion(section: Element): void {
  const header = section.querySelector<HTMLElement>('.section-header');
  if (!header) return;
  if (!header.id) header.id = `${sectionId(section)}-toggle`;
  header.addEventListener('click', () => {
    const open = section.classList.contains('collapsed');
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.getElementById('controlsPane')?.querySelectorAll('.section').forEach(sibling => {
        if ((sibling as HTMLElement).offsetParent !== null) setSectionOpen(sibling, false);
      });
    }
    setSectionOpen(section, open);
  });
}

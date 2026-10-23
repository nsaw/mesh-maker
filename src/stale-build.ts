/**
 * Whether the site was deployed again since this page loaded. A deploy replaces every hashed chunk, so a
 * page opened before it cannot load a chunk or a Worker it has not loaded yet: Cloudflare answers the old
 * name with the HTML page. Callers ask only after such a load failed, to tell "the app was updated" from
 * a real failure (offline, a blocked request). Nothing reloads by itself: a reload would drop the figure,
 * the settings and any finished drape, so the user decides.
 */

const ENTRY = /\/assets\/index-[\w-]+\.js/;

export const UPDATED_MESSAGE = 'MeshCraft was updated since this page opened. Reload the page to continue (COPY LINK first keeps your settings).';

/** True when the live index.html names a different entry script from the one this page runs. False when
 *  it cannot tell (offline, a development server, a failed request). */
export async function updatedSinceLoad(): Promise<boolean> {
  const mine = Array.from(document.scripts, s => s.src).find(src => ENTRY.test(src));
  if (!mine) return false;
  try {
    // Bounded: a stalled request must not hold the caller's message (or a busy button) indefinitely.
    const res = await fetch('/', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const live = (await res.text()).match(ENTRY)?.[0];
    return live !== undefined && !mine.endsWith(live);
  } catch {
    return false;                                               // offline or blocked: not an update
  }
}

/** A failed dynamic import, in the wording of Chromium, Safari or Firefox. */
export function isChunkLoadError(err: unknown): boolean {
  const why = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(why);
}

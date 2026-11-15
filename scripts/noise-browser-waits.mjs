/** A completion belongs to the action after this captured request, never an older full result. */
export async function waitForFullNoiseResult(page, after) {
  if (!Number.isSafeInteger(after) || after < 0) throw new RangeError('Full completion needs an explicit request boundary');
  await page.waitForFunction(after => window.noiseProbe.results.some(result => result.id > after && result.params.resolution === 400)
    && !document.getElementById('genOverlay').classList.contains('visible'), after, {timeout: 30_000});
}

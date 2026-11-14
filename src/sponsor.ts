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

}

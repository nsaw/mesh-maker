/** Keep the configured app reachable over HTTP or HTTPS while excluding third parties. */
export function restrictToAppOrigin(target, origin) {
  const appOrigin = new URL(origin).origin;
  return target.route('**/*', route => new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort());
}

/** Tests follow the same task navigation as a phone user; desktop keeps the full sidebar. */
export async function mobilePane(page, pane) {
  if (page.viewportSize().width <= 900) await page.locator(`#tab-${pane}`).click();
}
export async function toolbarAction(page, id) {
  if (page.viewportSize().width <= 900 && !(await page.locator(`#${id}`).isVisible())) await page.locator('#btnOverflow').click();
  await page.locator(`#${id}`).click();
}

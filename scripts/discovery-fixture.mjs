export async function openDiscovery(page, ai) {
  await page.getByRole('tab', { name: '找歌', exact: true }).click()
  const toggle = page.getByRole('button', { name: 'AI 推荐', exact: true })
  if ((await toggle.getAttribute('aria-pressed')) !== String(ai)) await toggle.click()
}

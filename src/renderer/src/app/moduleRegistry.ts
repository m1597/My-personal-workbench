import { fixturePanels } from '../../../../tests/fixtures/workspace/panels'
export { icons, minimumPanelSize } from '../../../../tests/fixtures/workspace/panels'
export const fixtureWorkspace = new URLSearchParams(location.search).get('fixturePanels') === '1'
export const modules: readonly (typeof fixturePanels)[number][] = fixtureWorkspace
  ? fixturePanels
  : []
export const retiredPanelIds = fixturePanels.map((panel) => panel.id as string)

import path from 'node:path'
export const pluginFile = (id) =>
  path.resolve('dist/component-prototype/plugin-packs', id + '.fitbayplugin')
export function choosePluginFile(app, id) {
  return app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, pluginFile(id))
}

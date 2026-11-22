export async function countLiveTrays(app) {
  // Electron's main process exposes live Tray wrappers to its Node inspector.
  return await app.evaluate(async ({ Tray }) => {
    const { Session } = process.getBuiltinModule('inspector/promises')
    const inspector = new Session()
    inspector.connect()
    try {
      globalThis.fitbayTrayPrototype = Tray.prototype
      const { result } = await inspector.post('Runtime.evaluate', {
        expression: 'globalThis.fitbayTrayPrototype',
      })
      const { objects } = await inspector.post('Runtime.queryObjects', {
        prototypeObjectId: result.objectId,
      })
      const { result: count } = await inspector.post('Runtime.callFunctionOn', {
        objectId: objects.objectId,
        functionDeclaration:
          'function(){return this.filter(t=>{try{return !t.isDestroyed() && t.getBounds().width >= 0}catch{return false}}).length}',
        returnByValue: true,
      })
      if (count.value === undefined) throw Error(count.description)
      return count.value
    } finally {
      delete globalThis.fitbayTrayPrototype
      inspector.disconnect()
    }
  })
}

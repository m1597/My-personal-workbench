import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { componentInstallation } from '../examples/component-host/component-installation.mjs'

for (const [id, slot] of Object.entries({
  music: 'Music',
  prompts: 'Prompts',
  toolkit: 'Toolkit',
})) {
  test('registered uninstall preserves ' + slot + ' location and unrelated files', async (t) => {
    const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'fitbay uninstall '))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const root = path.join(directory, 'resources', 'app')
    const file = path.join(directory, 'Uninstall FitBay ' + slot + '.exe')
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, 'package.json'), '{"version":"0.2.4"}')
    await writeFile(file, 'fixture')
    await writeFile(path.join(directory, 'user.txt'), 'keep')
    let installed = true,
      registered = false
    const calls = []
    const setup = componentInstallation(
      {
        product: 'workbench',
        find: async (key) => (key === id && installed ? root : undefined),
        registered: async () => (registered ? root : undefined),
      },
      directory,
      null,
      async (program, args, options) => {
        if (program === file) assert.equal(options.windowsVerbatimArguments, true)
        calls.push([program, args])
        if (program === file) installed = false
      },
    )
    await setup.uninstall(id)
    assert.equal(calls.length, 0)
    assert.equal((await setup.list()).find((row) => row.id === id).stage, 'uninstalling')
    registered = true
    await setup.uninstall(id)
    assert.deepEqual(calls, [
      [
        path.join(process.env.SystemRoot, 'System32', 'reg.exe'),
        [
          'add',
          path.win32.join('HKCU', 'Software', 'FitBay', 'PreviousInstallations'),
          '/v',
          slot,
          '/t',
          'REG_SZ',
          '/d',
          directory,
          '/f',
          '/reg:64',
        ],
      ],
      [file, ['/S', '/currentuser', '_?=' + directory]],
    ])
    assert.equal((await setup.list()).find((row) => row.id === id).status, 'missing')
    await assert.rejects(stat(file), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(directory, 'user.txt'), 'utf8'), 'keep')
  })
}

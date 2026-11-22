import { spawn } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { copyFile, writeFile, rm } from 'node:fs/promises'

export async function startSelfUpdate({ file, digest, version, profile, executable }) {
  const script = path.join(path.dirname(file), 'self-update.ps1')
  const launcher = path.join(path.dirname(file), 'self-update.vbs')
  await copyFile(new URL('./self-update.vbs', import.meta.url), launcher)
  const marker = path.join(profile, 'self-update-target')
  await copyFile(new URL('./self-update.ps1', import.meta.url), script)
  await writeFile(marker, version)
  const readyFile = path.join(path.dirname(file), 'ready')
  const worker = spawn(
    path.join(process.env.SystemRoot, 'System32/wscript.exe'),
    ['//B', '//Nologo', launcher, script],
    {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        FITBAY_UPDATE_READY: readyFile,
        FITBAY_UPDATE_PARENT: String(process.pid),
        FITBAY_UPDATE_FILE: file,
        FITBAY_UPDATE_SHA256: digest.slice(7),
        FITBAY_UPDATE_APP: executable,
        FITBAY_UPDATE_PROFILE: profile,
      },
    },
  )
  let failed = false
  worker.once('error', () => {
    failed = true
  })
  try {
    const deadline = Date.now() + 15000
    while (!existsSync(readyFile)) {
      if (failed || worker.exitCode !== null || Date.now() >= deadline)
        throw Error('Update helper unavailable')
      await delay(50)
    }
  } catch (error) {
    worker.kill()
    await rm(marker, { force: true })
    throw error
  } finally {
    worker.unref()
  }
}

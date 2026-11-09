import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Failure cases run against disposable fixtures, never rename real project configuration.
function inspect(files) {
  mkdirSync('tmp', { recursive: true })
  const root = mkdtempSync(path.resolve('tmp/doctor-'))
  try {
    mkdirSync(path.join(root, 'scripts'))
    copyFileSync('scripts/doctor.mjs', path.join(root, 'scripts/doctor.mjs'))
    for (const [name, contents] of Object.entries(files))
      writeFileSync(path.join(root, name), contents)
    return spawnSync(process.execPath, [path.join(root, 'scripts/doctor.mjs')], {
      encoding: 'utf8',
      env: process.env,
    })
  } finally {
    // mkdtemp-created directory, constrained to the repository's tmp folder.
    assert.ok(root.startsWith(`${path.resolve('tmp')}${path.sep}`))
    rmSync(root, { recursive: true, force: true })
  }
}
test('缺失配置给出修复指引，不输出异常堆栈', () => {
  const result = inspect({})
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL package.json.*文件缺失/)
  assert.match(result.stdout, /npm run postinstall/)
  assert.equal(result.stderr, '')
})
test('损坏锁文件与缺失依赖分别报告，不因第一个错误退出', () => {
  const result = inspect({
    'package.json': JSON.stringify({
      name: 'doctor-fixture',
      packageManager: 'npm@11.17.0',
      dependencies: { 'missing-fixture-package': '1.0.0' },
    }),
    '.node-version': process.versions.node,
    'package-lock.json': '{broken',
  })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL 依赖缺失/)
  assert.match(result.stdout, /FAIL package-lock.json.*格式错误/)
  assert.match(result.stdout, /npm ci/)
  assert.equal(result.stderr, '')
})

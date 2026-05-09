import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { scan } from './analyzer.js'

const makeProject = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'doctor-node-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'demo',
    dependencies: { express: '^4.18.0', jsonwebtoken: '^9.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  }, null, 2))
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: false } }))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src/server.ts'), `
    import express from 'express'
    import jwt from 'jsonwebtoken'
    const app = express()
    app.post('/admin/delete', async (req, res) => { res.json({ ok: true }) })
    jwt.verify(token, secret)
    for (const item of items) { await save(item) }
  `)
  return root
}

test('detects Node project issues and frameworks', async () => {
  const root = await makeProject()
  const result = await scan({ root, json: false, includeTests: false, maxFiles: 100 })
  assert.equal(result.frameworks[0]?.name, 'Express')
  assert.ok(result.diagnostics.some((item) => item.id === 'node.ts.strict.disabled'))
  assert.ok(result.diagnostics.some((item) => item.id === 'node.express.helmet.missing'))
  assert.ok(result.diagnostics.some((item) => item.id === 'node.api.mutating-route-auth-signal-missing'))
  assert.ok(result.score < 100)
})

test('detects bun lockfiles as bun package manager', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctor-node-bun-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bun-demo', scripts: { test: 'bun test' } }))
  await writeFile(join(root, 'bun.lockb'), '')
  const result = await scan({ root, json: false, includeTests: false, maxFiles: 100 })
  assert.equal(result.packageManager, 'bun')
})

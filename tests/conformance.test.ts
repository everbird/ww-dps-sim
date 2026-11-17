// DD-10 §8 C10-7/C10-8：真实 CLI 往返与字段篡改；无 data/generated 依赖。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, test } from 'vitest'
import { BOUNDARY_CASES, boundaryRun } from '../src/cli/conformance-cases'
import { readManifest } from '../src/cli/conformance-artifacts'
import { runPrepared } from '../src/engine/run'
import { OUTPUT_SCHEMA_VERSION } from '../src/engine/run-types'
import { WIRE_SCHEMA_VERSION } from '../src/engine/wire'
import { sha256Hex } from '../src/engine/digest'

const dir = mkdtempSync(join(tmpdir(), 'conformance-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const cli = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/conformance.ts', ...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  return result
}

describe('DD-10 conformance', () => {
  test('C10-7 导出七条停止路径与四组相位边界，再 --verify 读回', () => {
    const written = cli('--boundaries-only', '--out', dir)
    expect(written.stderr).toBe('')
    expect(written.status).toBe(0)
    const manifest = readManifest(dir)
    expect(manifest.OUTPUT_SCHEMA_VERSION).toBe(OUTPUT_SCHEMA_VERSION)
    expect(manifest.WIRE_SCHEMA_VERSION).toBe(WIRE_SCHEMA_VERSION)
    expect(manifest.cases.map(c => c.name)).toEqual(BOUNDARY_CASES.map(c => `boundary-${c}`))
    for (const c of manifest.cases) {
      for (const [file, hash] of Object.entries(c.files)) expect(sha256Hex(readFileSync(join(dir, file), 'utf8'))).toBe(hash)
      const input = JSON.parse(readFileSync(join(dir, `${c.name}.input.json`), 'utf8'))
      const output = JSON.parse(readFileSync(join(dir, `${c.name}.output.json`), 'utf8'))
      expect(input).toHaveProperty('resolved.data.hooks', {})
      expect(input).toHaveProperty('effective.sample', null)
      expect(input.identity).toEqual(output.identity)
      expect(input.identity.execution).not.toHaveProperty('gitCommit')
      expect(input.identity.execution).not.toHaveProperty('contentFingerprint')
      expect(output.runId).toBe(c.runId)
      for (const field of ['completion', 'interventions', 'strictReport', 'ruleUsage', 'damageScope', 'forte', 'cooldowns']) expect(output).toHaveProperty(field)
      expect(output).not.toHaveProperty('diag')
    }
    const verified = cli('--verify', dir)
    expect(verified.stderr).toBe('')
    expect(verified.status).toBe(0)
    expect(verified.stdout).toContain('对拍 ✓：11')
  }, 30_000)

  test('七条路径确实各走一遍（不是只换文件名）', () => {
    const results = BOUNDARY_CASES.slice(0, 7).map(c => runPrepared(boundaryRun(c)))
    expect(results.map(r => [r.completion.status, r.completion.coverage.terminal.kind])).toEqual([
      ['completed', 'afterPostDrain'], ['truncated', 'afterPostDrain'], ['truncated', 'afterFailClose'],
      ['engineError', 'postDrainFailed'], ['axisFailed', 'midTick'], ['engineError', 'midTick'], ['engineError', 'initIncomplete'],
    ])
    expect(results[1]!.completion.truncation?.kind).toBe('inFlightRemains')
    expect(results[2]!.completion.truncation?.kind).toBe('commandsPending')
    expect(results[5]!.completion.engineError?.code).toBe('chainDepth')
  }, 30_000)

  test('相位边界保留冷却、命中/到期先后、多个到期及交错队列', () => {
    const run = (name: typeof BOUNDARY_CASES[number]) => runPrepared(boundaryRun(name)).log
    expect(run('phase-cooldown').filter(e => e.type === 'actionStart').map(e => e.f)).toEqual([0, 60])
    const expire = run('phase-hit-expire')
    const hits = expire.filter(e => e.type === 'hit')
    expect(hits.map(e => [e.f, e.buffs])).toEqual([[29, ['甲.攻击']], [30, []]])
    expect(expire.findIndex(e => e.type === 'hit')).toBeLessThan(expire.findIndex(e => e.type === 'buffExpire'))
    const multi = run('phase-multiple-expire')
    const start = multi.findIndex(e => e.type === 'buffExpire')
    expect(multi.slice(start, start + 4).map(e => e.type)).toEqual(['buffExpire', 'buffExpire', 'resource', 'resource'])
    const mixed = run('phase-interleaved')
    const e1 = mixed.findIndex(e => e.type === 'hit')
    const e2 = mixed.findIndex(e => e.type === 'resourceFull' && e.char === '甲')
    const x1 = mixed.findIndex(e => e.type === 'resource' && e.resource === 'core1')
    const x2 = mixed.findIndex(e => e.type === 'resource' && e.resource === 'core2')
    expect(e1).toBeGreaterThanOrEqual(0)
    expect(e1 < e2 && e2 < x1 && x1 < x2).toBe(true)
  }, 30_000)

  test('外部实现采用不同缩进并重算清单摘要，语义相同应通过', () => {
    const manifest = readManifest(dir)
    for (const c of manifest.cases) for (const file of Object.keys(c.files)) {
      const text = JSON.stringify(JSON.parse(readFileSync(join(dir, file), 'utf8')), null, 2) + '\n'
      writeFileSync(join(dir, file), text)
      ;(c.files as Record<string, string>)[file] = sha256Hex(text)
    }
    writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
    expect(cli('--verify', dir, '--no-zero-interference').status).toBe(0)
  }, 30_000)

  test('空清单、文件缺失、版本不符、摘要不符都拒绝', () => {
    const manifestFile = join(dir, 'MANIFEST.json')
    const original = readFileSync(manifestFile, 'utf8')
    const manifest = JSON.parse(original)
    for (const invalid of [
      { ...manifest, cases: [] },
      { ...manifest, WIRE_SCHEMA_VERSION: 'future' },
    ]) {
      writeFileSync(manifestFile, JSON.stringify(invalid))
      expect(cli('--verify', dir, '--no-zero-interference').status).toBe(1)
    }
    writeFileSync(manifestFile, original)
    const file = join(dir, 'boundary-stop-idle.output.json')
    const output = readFileSync(file, 'utf8')
    writeFileSync(file, output + ' ')
    const checksum = cli('--verify', dir, '--no-zero-interference')
    expect(checksum.status).toBe(1)
    expect(checksum.stderr).toContain('摘要不符')
    rmSync(file)
    expect(cli('--verify', dir, '--no-zero-interference').stderr).toContain('文件不存在')
    writeFileSync(file, output)
  }, 30_000)

  test('C10-8 篡改某条事件，--verify 非零并报告首个字段路径', () => {
    const file = join(dir, 'boundary-stop-idle.output.json')
    const original = readFileSync(file, 'utf8')
    const output = JSON.parse(original)
    const index = output.log.findIndex((e: { type: string }) => e.type === 'hit')
    output.log[index].f += 1
    writeFileSync(file, JSON.stringify(output))
    const verified = cli('--verify', dir, '--no-zero-interference')
    expect(verified.status).toBe(1)
    expect(verified.stderr).toContain(`boundary-stop-idle.output.json.log[${index}].f`)
    writeFileSync(file, original)
  }, 30_000)
})

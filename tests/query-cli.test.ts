// tests/query-cli.test.ts —— pnpm query（src/cli/query.ts，DD-07 §10.3）的真实命令行往返：信封的能力说明按 DD-07 §10.1 的固定字符串，
// 伤害口径的两项披露（DD-02 §3.7），run 带 strictReport 与谐破口径，假想事件的未知角色名报查询错误（不崩），diff 的参数检查。
// 起子进程跑 tsx（同 tests/conformance.test.ts），依赖 data/generated（缺数据时跳过）。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { dataDescribe } from './helpers/kernel-harness'

// 严格代表轴：谐度破坏按原文没给位置省略（tuneBreakOmitted sourceSilent、options.tuneBreak off）
const SCENARIO = 'scenarios/m0-video-eq-不打谐破.yaml'
const OMITTED = ['damage.tuneBreak: 未含谐度破坏（sourceSilent）', 'damage.disharmonyDependent']
const dir = mkdtempSync(join(tmpdir(), 'query-cli-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

interface Envelope {
  schemaVersion: string
  completion: { status: string }
  capability: { capabilitiesUsed: string[]; unsupported: string[] }
  data: Record<string, unknown>
}
const query = (name: string, ...args: string[]): { status: number | null; stderr: string; env?: Envelope } => {
  const out = join(dir, `${name}.json`)
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/query.ts', SCENARIO, ...args, '--out', out], { encoding: 'utf8' })
  if (r.error) throw r.error
  let env: Envelope | undefined
  try { env = JSON.parse(readFileSync(out, 'utf8')) as Envelope } catch { env = undefined }
  return { status: r.status, stderr: r.stderr, ...(env ? { env } : {}) }
}

dataDescribe('pnpm query 命令行（DD-07 §10）', () => {
  test('run：数据带 strictReport 与谐破口径；能力说明用固定字符串，未含谐破的两项由信封补上', () => {
    const x = query('run', 'run')
    expect(x.status).toBe(0)
    expect(x.env!.capability.capabilitiesUsed).toEqual(['run'])
    expect(x.env!.capability.unsupported).toEqual(OMITTED)
    expect(Object.keys(x.env!.data).sort()).toEqual(['damageScope', 'eventCount', 'runId', 'strictReport', 'summary'])
    expect(x.env!.data.strictReport).toMatchObject({ entry: 'strict' })
    expect(x.env!.data.damageScope).toEqual({ tuneBreak: { gauge: 'off', mode: 'omitted', reason: 'sourceSilent' } })
  }, 60_000)

  test('state / explain / would：state.recompute、diag.*、probe.firing；explain 与 would 披露各自做不了的部分', () => {
    const st = query('state', 'state', '--frame', '600')
    expect(st.status).toBe(0)
    expect(st.env!.capability.capabilitiesUsed).toEqual(['state.recompute'])
    expect(st.env!.data).toMatchObject({ frame: 600 })
    const ex = query('explain', 'explain', '--seq', '300')
    expect(ex.status).toBe(0)
    expect(ex.env!.capability.capabilitiesUsed.slice(0, 4)).toEqual(['diag.eventMeta', 'diag.hitInputs', 'diag.resourceLedger', 'diag.ruleTrace'])
    expect(ex.env!.capability.unsupported).toEqual(['间接的时序影响', ...OMITTED])
    const wo = query('would', 'would', '--frame', '600', '--event', JSON.stringify({ type: 'switch', from: '椿', to: '散华' }), '--kind', 'consume', '--owner', '0', '--id', 'x')
    expect(wo.status).toBe(0)
    expect(wo.env!.capability.capabilitiesUsed).toEqual(['state.recompute', 'probe.firing'])
    expect(wo.env!.capability.unsupported).toEqual(['帧内时刻', ...OMITTED])
  }, 60_000)

  test('would：假想事件的角色名不在队伍里是查询错误（退出码 2），不是未捕获的 TypeError（Antigravity 审查 H2）', () => {
    const ev = { type: 'hit', char: '不存在', action: 'A', judgment: 'x', tags: [], element: '冷凝' }
    const x = query('would-bad', 'would', '--frame', '600', '--event', JSON.stringify(ev), '--kind', 'buff', '--owner', '0', '--id', 'x')
    expect(x.status).toBe(2)
    expect(x.stderr).toContain('假想事件里的角色名不在队伍中：不存在')
    expect(x.stderr).not.toContain('TypeError')
  }, 60_000)

  test('diff：--cmd、--mapping 的写法检查；--cand-fill 要配合另一个场景', () => {
    expect(query('diff-cmd', 'diff', '--target', 'events', '--cmd', 'bad').stderr).toContain('--cmd 应写成 <轮>:<条>.<项>')
    expect(query('diff-map', 'diff', '--target', 'metrics', '--mapping', '1:1.1=1:1.1').stderr).toContain('--mapping 只对 --target commands|events 有用')
    expect(query('diff-fill', 'diff', '--cand-fill', 'x').status).toBe(2)
    const ok = query('diff-events', 'diff', '--target', 'events', '--cmd', '1:2.1', '--cand-option', 'inputDelay=6')
    expect(ok.status).toBe(0)
    expect(ok.env!.capability.capabilitiesUsed).toEqual(['diff.events'])
    expect(ok.env!.capability.unsupported).toEqual(['三项及以上的归因', ...OMITTED])
    const diff = ok.env!.data.diff as { sameAxis: boolean; correspondences: { status: string }[] }
    expect(diff.sameAxis).toBe(true)
    expect(diff.correspondences.length).toBeGreaterThan(0)
  }, 60_000)
})

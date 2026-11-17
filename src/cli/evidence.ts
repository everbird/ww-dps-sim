// src/cli/evidence.ts —— pnpm evidence：证据闭环（DD-08 §4.2、§5.2；记录格式见 src/data/evidence.schema.ts）。
//   pnpm evidence predict <闭环.yaml> [--verify]   跑各候选在各 setup 上的运行，填 runs 与 predictions，打印区分度检查；登记之后只能 --verify
//   pnpm evidence register <闭环.yaml>             登记预测（实验）：冻结预测运行的身份（docs/evidence/runs/）、观测定义与预测值的两个摘要。先提交代码
//   pnpm evidence judge <闭环.yaml> [--verify]     观测填好之后：拿冻结的预测与读数比，写 verdicts 与 conclusion；decision 留给人填
//   pnpm evidence rerun <闭环.yaml>                decision 填好之后：重跑受影响的场景（采用前、后各一次），填 reruns
//   pnpm evidence ledger <闭环.yaml>               打印要加进 src/engine/propositions.ts 的证据条目与结论（DD-08 §4.3）
//   pnpm evidence --md                             把全部闭环记录渲染成 docs/evidence/README.md 的总表
//   pnpm evidence --stale                          列出观测的游戏版本与当前声明的不同、需要复核的证据（DD-08 §7）
// 三个子命令都只写自己负责的字段，重复运行结果不变。退出码：0 正常；1 拒绝（登记后改过、预测过期、重跑不该变的变了…）或出错
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parse } from 'yaml'
import { CalibrationFileSchema, type Observation } from '../data/calibration.schema'
import type { ClosureRecord } from '../data/evidence.schema'
import { loadGameData } from '../data/load'
import type { Scenario } from '../data/scenario.schema'
import {
  EvidenceError, evidenceFromClosure, judgeClosure, observationsOf, predictClosure, registerClosure, registrationProblems, rerunClosure,
  verifyPredictions, type EvidenceContext,
} from '../analysis/evidence'
import { hasReading } from '../analysis/observations'
import { PROPOSITIONS, propositionOf, type Proposition } from '../engine/propositions'
import { conclusionText, evidenceTable, summarizeClosure, VERDICT_LABEL } from '../report/evidence'
import { EVIDENCE_DIR, readClosure, readIdentities, RUNS_DIR, writeClosure, writeIdentities, type ClosureFile } from './evidence-file'
import { loadScenario } from './format'
import { writeGenerated } from './generated-doc'
import { currentGameVersion } from './game-version'
import { collectRunEnvironment } from './run-env'

const POINTS = 'docs/calibration/points.yaml'
const USAGE = 'pnpm evidence predict|register|judge|rerun|ledger <docs/evidence/闭环.yaml> [--verify]，或 pnpm evidence --md | --stale'

const loadPoints = (): Observation[] => CalibrationFileSchema.parse(parse(readFileSync(POINTS, 'utf8'))).points
const closureFiles = (): string[] => (existsSync(EVIDENCE_DIR) ? readdirSync(EVIDENCE_DIR).filter(f => f.endsWith('.yaml')).sort().map(f => join(EVIDENCE_DIR, f)) : [])

function propositionFor(r: ClosureRecord): Proposition {
  const p = propositionOf(r.propositionId)
  if (!p) throw new EvidenceError(`${r.id}：台账里没有命题 ${r.propositionId}（先在 src/engine/propositions.ts 登记，没实现的候选也入账）`)
  return p
}

async function contextOf(f: ClosureFile): Promise<EvidenceContext> {
  const scenarios = new Map<string, Scenario>(f.record.setups.map(s => [s.scenario, loadScenario(join('scenarios', s.scenario))]))
  return { data: await loadGameData(), scenarios, observations: loadPoints(), proposition: propositionFor(f.record), environment: collectRunEnvironment() }
}

/** 登记的身份文件：一条闭环一个，runId → 身份 */
const registerFile = (r: ClosureRecord) => `${RUNS_DIR}/${r.id}.predict.json`
const rerunFile = (r: ClosureRecord) => `${RUNS_DIR}/${r.id}.rerun.json`

async function predict(f: ClosureFile, verify: boolean): Promise<number> {
  const ctx = await contextOf(f)
  if (f.record.preRegistration) {
    if (!verify) { console.error(`${f.record.id}：已经登记（${f.record.preRegistration.date}），不再覆写预测；要核对用 --verify`); return 1 }
    const v = verifyPredictions(f.record, ctx, readIdentities(f.record.preRegistration.identities))
    for (const l of v.lines) console.log(l)
    return v.ok ? 0 : 1
  }
  if (verify) { console.error(`${f.record.id}：还没登记，--verify 没有可核对的`); return 1 }
  const out = predictClosure(f.record, ctx)
  writeIdentities(registerFile(f.record), out.identities)
  writeClosure(f, { candidates: out.record.candidates })
  console.log(`${f.record.id}：预测写进 ${f.path}（各运行的身份在 ${registerFile(f.record)}）`)
  for (const c of out.record.candidates) {
    const runs = c.runs.map(r => `${r.setupId} ${r.runId}（${r.status}${r.detail ? `：${r.detail}` : ''}）`).join('；') || '没实现，没有运行'
    console.log(`  ${c.candidateId}：${runs}`)
    for (const p of c.predictions) console.log(`    ${p.observationId}：${JSON.stringify(p.predicted)}${p.covered ? '' : '（不在覆盖范围里）'}${p.reason ? `  ${p.reason}` : ''}${p.manual ? '  手算' : ''}`)
  }
  console.log('\n区分度（DD-08 §5.2 第 3 步：按预登记的判据，接受区间不重叠才可区分）：')
  for (const l of out.check.lines) console.log(`  ${l}`)
  return 0
}

async function register(f: ClosureFile): Promise<number> {
  const ctx = await contextOf(f)
  if (ctx.environment?.gitCommit === 'unknown') { console.error('不在 git 仓库里：登记要记提交号'); return 1 }
  const file = registerFile(f.record)
  const out = registerClosure(f.record, ctx, { date: new Date().toISOString().slice(0, 10), identityPath: id => `${file}#${id}` })
  writeIdentities(file, new Map(out.files.map(x => [x.path.split('#')[1]!, x.identity])))
  writeClosure(f, { preRegistration: out.record.preRegistration! })
  console.log(`${f.record.id}：登记了 ${out.files.length} 次预测运行（身份在 ${file}），提交 ${out.record.preRegistration!.commit}`)
  console.log('接着提交这个闭环文件与身份文件，再进游戏；之后不再改候选、判据与观测的容差（DD-08 §5.2 第 4 步）')
  return 0
}

async function judge(f: ClosureFile, verify: boolean): Promise<number> {
  const p = propositionFor(f.record)
  const points = loadPoints()
  const problems = registrationProblems(f.record, points)
  if (problems.length) { for (const x of problems) console.error(`${f.record.id}：${x}`); return 1 }
  if (verify && f.record.preRegistration) {
    const v = verifyPredictions(f.record, await contextOf(f), readIdentities(f.record.preRegistration.identities))
    for (const l of v.lines) console.log(l)
    if (!v.ok) { console.error(`${f.record.id}：预测已过期，不判；需另开一条记录`); return 1 }
  }
  // 观测填好之后才判（DD-08 §4.2）：评分观测一条读数都没有时不写（不然会存下一个"未验证"的空结论）
  const scored = observationsOf(f.record, points).filter(o => o.purpose !== 'given')
  if (!scored.some(hasReading)) { console.error(`${f.record.id}：观测还没有读数（points.yaml 的 game / gameRange，切人类型的 expect），先读数再 judge`); return 1 }
  const j = judgeClosure(f.record, p, points)
  if (j.conclusion.proposition === 'ambiguous' && !f.record.discriminatingObservationNeeded) {
    console.error(`${f.record.id}：结论是${conclusionText(j.conclusion)}，要先在记录里写 discriminatingObservationNeeded（下一项能区分的观测），再 judge`)
    return 1
  }
  writeClosure(f, { verdicts: j.verdicts, conclusion: j.conclusion })
  console.log(`${f.record.id}：${conclusionText(j.conclusion)}`)
  for (const v of j.verdicts) console.log(`  ${v.candidateId}：${VERDICT_LABEL[v.overall]}${v.notAssessedReason ? `（${v.notAssessedReason}）` : ''}  ${v.perObservation.map(x => `${x.observationId} ${x.status}${x.covered ? '' : '（不在覆盖范围里）'}`).join('、')}`)
  console.log('采用决定（decision）由人填；填好后 pnpm evidence rerun，再 pnpm evidence ledger 把证据条目加进台账')
  return 0
}

async function rerun(f: ClosureFile): Promise<number> {
  const p = propositionFor(f.record)
  const data = await loadGameData()
  const scenarios = new Map(readdirSync('scenarios').filter(x => x.endsWith('.yaml')).sort().map(x => [x, loadScenario(join('scenarios', x))] as const))
  const out = rerunClosure(f.record, p, data, scenarios, collectRunEnvironment())
  writeIdentities(rerunFile(f.record), out.identities)
  writeClosure(f, { reruns: out.reruns })
  console.log(`${f.record.id}：受影响的场景 ${out.affected.length} 个（身份在 ${rerunFile(f.record)}）`)
  for (const a of out.affected) {
    const x = out.reruns.find(r => r.scenario === a.scenario)!
    const dps = (s: typeof x.before) => (s.dps === null ? s.status : Math.round(s.dps).toLocaleString('en-US'))
    console.log(`  ${a.scenario}（${a.why}）：${dps(x.before)} → ${dps(x.after)}${x.changed ? '，变了' : '，相同'}`)
  }
  for (const x of out.problems) console.error(`  ✗ ${x}`)
  return out.problems.some(x => !x.includes('跨代码版本')) ? 1 : 0
}

/** 台账要加的证据条目（DD-08 §4.3）：TS 字面量，贴进 propositions.ts 对应命题的 evidence，结论照抄 */
function ledger(f: ClosureFile): number {
  const p = propositionFor(f.record)
  const points = loadPoints()
  if (!f.record.conclusion) { console.error(`${f.record.id}：还没 judge`); return 1 }
  const j = judgeClosure(f.record, p, points)
  const ev = evidenceFromClosure(f.record, j, p, points)
  console.log(`// ${p.id}：conclusion: '${j.conclusion.proposition}'（${conclusionText(j.conclusion)}）`)
  console.log(`// 证据条目（${f.path}）：`)
  console.log(JSON.stringify(ev, null, 2))
  return 0
}

function markdown(): number {
  const points = loadPoints()
  const rows = closureFiles().map(file => {
    const { record } = readClosure(file)
    return summarizeClosure(record, propositionOf(record.propositionId), points)
  })
  writeGenerated(`${EVIDENCE_DIR}/README.md`, evidenceTable(rows), HEADER)
  console.log(`${EVIDENCE_DIR}/README.md：${rows.length} 条闭环`)
  return rows.every(r => r.consistent) ? 0 : 1
}

const HEADER = `# 证据闭环

## 读法

一条闭环一个文件（\`<闭环 ID>.yaml\`，格式见 \`src/data/evidence.schema.ts\`、DD-08 §4.1）：候选 → 条件化预测 → 观测及误差范围 → 判断 → 采用决定 → 受影响场景重跑。

- **结论**按 DD-08 §4.1 的决策表算，说的是"所指候选"（当前采用的那个）：证实（所测条件内）要求每个竞争候选都被同一条独立检验的观测排除（第 4 行）；只有相容或选模材料的是"暂定"；"分不清"要写出下一项能区分的观测。
- **相容不是证实**：一条观测与几个候选都相容时，对它们都只是"相容但区分不了"。
- **采用决定**由人填，与结论分开存；"重跑"是采用决定之后，同一份代码上采用前、后两个值的对照。
- 观测在 \`docs/calibration/points.yaml\`，进游戏实验的记录在 \`docs/experiments/\`。

生成：\`pnpm evidence --md\`（DD-08 §4.2）。`

function stale(): number {
  const current = currentGameVersion()
  const points = loadPoints()
  console.log(`当前声明的游戏版本：${current ?? '没写（data/xlsx-versions.json 的 current 条目加 gameVersion）'}`)
  const ver = (o: Observation) => (o.condition?.gameVersion && o.condition.gameVersion !== 'unknown' ? o.condition.gameVersion : '未知')
  let n = 0
  for (const file of closureFiles()) {
    const { record } = readClosure(file)
    for (const o of observationsOf(record, points)) {
      if (!o.condition || (o.kind === 'switchType' ? o.expect === null : o.game === null && !o.gameRange)) continue
      const v = ver(o)
      if (v === current) continue
      n++
      console.log(`  ${basename(file)} / ${o.id}：观测来自 ${v}${v === '未知' ? '（版本不详）' : `，沿用自 ${v}，待复核`}`)
    }
  }
  for (const p of PROPOSITIONS as readonly Proposition[]) for (const e of p.evidence) {
    if (e.id.startsWith('legacy:') || e.observation.gameVersion === current) continue
    n++
    console.log(`  台账 ${p.id} / ${e.id}：${e.observation.gameVersion === '未知' ? '版本不详' : `沿用自 ${e.observation.gameVersion}，待复核`}（结论不因沿用升级，路线图 §5.4）`)
  }
  console.log(n === 0 ? '没有要复核的证据' : `${n} 条要复核`)
  return 0
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter(a => a !== '--')
  if (args.includes('--md')) return markdown()
  if (args.includes('--stale')) return stale()
  const [cmd, file] = args.filter(a => !a.startsWith('--'))
  const verify = args.includes('--verify')
  if (!cmd || !file) { console.error(USAGE); return 1 }
  const f = readClosure(file)
  switch (cmd) {
    case 'predict': return predict(f, verify)
    case 'register': return register(f)
    case 'judge': return judge(f, verify)
    case 'rerun': return rerun(f)
    case 'ledger': return ledger(f)
    default: console.error(USAGE); return 1
  }
}

main().then(code => process.exit(code), e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })

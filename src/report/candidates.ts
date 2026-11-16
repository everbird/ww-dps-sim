// DD-04 §5.5：文字只从报告取数；时刻敏感不等于某一门槛是瓶颈。
import type { CandidateOutcome, CandidateRef, StrictCandidateReport } from '../engine/candidates'
const num = (x: number | null) => x === null ? '不可比' : x.toFixed(4)
const pct = (x: number | null) => x === null ? '不可比' : `${(x * 100).toFixed(4)}%`
const names = (cs: readonly CandidateRef[]) => cs.map(c => `${c.propositionId}=${c.candidateId}`).join(' × ')
const esc = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')
export function candidateMarkdown(r: StrictCandidateReport, command: string): string {
  const b = r.baseline, c = r.coverage
  const out = [
    '## 生成信息', '', `命令：\`${command}\``, `代码提交：\`${b.identity.execution.gitCommit}\``,
    `工作区指纹：\`${b.identity.execution.contentFingerprint ?? '无'}\``,
    `数据版本：${b.identity.data.xlsxFileDate}；xlsx SHA-256：${b.identity.data.xlsxSha256 ?? '未知'}`, `基准 runId：\`${b.runId}\``, '', '## 有条件结论', '',
    `${b.strictReport.earliestLegalBaseline ? '按最早合法帧执行' : `入口 ${b.strictReport.entry}，操作时刻 ${b.identity.execution.inputTiming}（inputDelay=${b.identity.execution.options.inputDelay}）`}；完成状态 ${b.status}，${b.comparedWindow}，平均每轮 ${num(b.steadyLoopBattleSeconds)} 战斗秒，DPS ${num(b.steadyDps)}。`,
  ]
  if (b.damageScope.tuneBreak.mode === 'omitted') out.push(`未含谐度破坏（${b.damageScope.tuneBreak.reason}；量表 ${b.damageScope.tuneBreak.gauge}）。`)
  if (r.scopeReference) {
    const s = r.scopeReference
    out.push(`同一条轴由调度器自动放谐破的参考：${s.status}，稳态 DPS ${num(s.steadyDps)}（相对基准 ${pct(s.dpsDeltaVsBaseline)}），谐破伤害占稳态 ${pct(s.tuneBreakDamageShare.steady)} / 全窗口 ${pct(s.tuneBreakDamageShare.wholeWindow)}；各轮战斗帧 ${s.steadyLoopBattleFrames?.join('、') ?? '不可用'}，轮长${s.loopTimeChanged === null ? '不可比' : s.loopTimeChanged ? '改变' : '不变'}。参考值不是这条轴的结论。runId：\`${s.runId}\`。`)
  }
  out.push(`记录到等待 ${r.observedWaits.length} 段；按意图的等待 ${b.intentWaitCount} 段（全运行，见下）。+6f 时刻对照：变长 ${r.timingSensitive.length}、吸收 ${r.timingAbsorbed.length}、变快 ${r.timingFaster.length}、不可评估 ${r.timingUnassessable.length}。门槛级的对照未做。`,
    `有效机制 / 数据候选单项 ${c.singlesRun}/${c.singlesPlanned}、两两 ${c.pairsRun}/${c.pairsPlanned}；断轴 ${c.axisFailedCount}、引擎错误 ${c.engineErrorCount}、未运行 ${c.notRunCount}。三项及以上未查。`,
    'DPS same 仅指数值相同（相对差 ≤ 1e-9）；窗口变化幅度不是误差条或置信区间。下表保留全部失败结果。')
  function table(title: string, rows: readonly CandidateOutcome[]) {
    out.push('', `## ${title}`, '', '| 候选 | 状态 | 窗口 | 每轮秒 | DPS | DPS变化 | 轮长 | 窗口幅度内 | 日志相同 | runId / 失败原因 |', '|---|---|---|---:|---:|---|---|---|---|---|')
    for (const o of rows) out.push(`| ${names(o.candidates)} | ${o.status} | ${o.comparedWindow} | ${num(o.steadyLoopBattleSeconds)} | ${num(o.steadyDps)} | ${o.dps.status} ${pct(o.dps.ratio)} | ${o.loopTime} | ${o.dps.withinWindowVariation ?? '—'} | ${o.identicalLog} | ${o.runId}${o.failureDetail ? ' / ' + esc(o.failureDetail) : ''} |`)
  }
  table('主表：机制与数据', r.mechanismOutcomes)
  table('操作策略试验（不计主表覆盖）', r.policyTrials)
  out.push('', '## 时刻对照（+6f；门槛级对照未做）', '')
  for (const [label, rows] of [['变长', r.timingSensitive], ['变快', r.timingFaster]] as const)
    for (const t of rows) out.push(`- ${label}：${t.cmd.line}.${t.cmd.item}，${t.window}，每轮 ${num(t.loopSecondsDelta)} 秒；记录到的等待原因 ${t.recordedWaits.join('、')}；gateConfirmed=false；${t.controlRunId}`)
  for (const t of r.timingAbsorbed) out.push(`- 吸收：${t.cmd.line}.${t.cmd.item}；${t.controlRunId}`)
  for (const t of r.timingUnassessable) out.push(`- 不可评估：${t.cmd.line}.${t.cmd.item}；${t.reason}；${t.runId ?? '未运行'}`)
  out.push('', '## 记录到的等待（稳态；不是门槛级结论）', '')
  for (const w of r.observedWaits) out.push(`- 第 ${w.cmd.loop} 轮 ${w.cmd.line}.${w.cmd.item}：${w.code}，${w.battleFrames} 战斗帧，intent=${w.intent}；${w.reason}`)
  out.push('', '## 按意图的等待、提示与完成状态', '', '```json', JSON.stringify({ completion: b.completion, strictReport: b.strictReport, warnings: b.warnings }, null, 2), '```', '', '## 排除与未覆盖', '')
  for (const x of r.excluded) out.push(`- 排除 ${names(x.candidates)}：${x.reason}`)
  out.push(`- 不适用：${names(r.notApplicable) || '无'}`, `- 未实现：${names(r.unimplemented) || '无'}`, `- 未列全：${r.nonExhaustivePropositions.join('、')}`, `- 依赖的未证实规则：${r.unverifiedDependencies.join('、')}`)
  return out.join('\n') + '\n'
}

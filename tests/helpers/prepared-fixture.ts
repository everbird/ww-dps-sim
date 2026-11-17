// DD-10 §5：低层机制测试直接注入装配夹具，不逆造源场景，也不提供生产兼容入口。
import type { GameData } from '../../src/data/gamedata'
import type { Scenario } from '../../src/data/scenario.schema'
import { digestOf } from '../../src/engine/digest'
import { damageScopeOf, prepareRun, resolvedDigestOf } from '../../src/engine/run'
import { OUTPUT_SCHEMA_VERSION, type PreparedRun, type RunIdentity, type RunOverrides } from '../../src/engine/run-types'
import type { ResolvedScenario } from '../../src/engine/types'

/** 有真实输入时始终测试正式归一入口；准备失败直接显示问题。 */
export function preparedScenario(sc: Scenario, data: GameData, overrides: RunOverrides = {}): PreparedRun {
  const p = prepareRun(sc, data, overrides)
  if (!p.ok) throw new Error(p.issues.map(i => i.message).join('；'))
  return p.run
}

/** 仅限测试：手工装配、修改面板、注入非法指令等执行夹具。
 * 身份明确写 test-fixture，不声称经过 schema / strict / resolve；不用于验证归一入口。
 * 每次按夹具重算摘要，避免修改夹具后误用旧身份。 */
export function fixturePreparedRun(r: ResolvedScenario, sample: RunOverrides['sample'] = undefined): PreparedRun {
  const strict = false
  const identity: RunIdentity = {
    data: { xlsxFileDate: r.data.version },
    execution: {
      gitCommit: 'test-fixture', scenarioDigest: 'test-fixture:no-source-scenario',
      resolvedDigest: resolvedDigestOf(r, true), entryMode: r.purpose === 'replay' ? 'replay' : 'standard',
      strictSource: 'default', inputTiming: r.options.inputDelay > 0 || Object.keys(r.options.inputDelayAt ?? {}).length > 0 || (sample?.jitter ?? 0) > 0 || sample?.hand !== undefined ? 'delayed' : 'earliest',
      rules: structuredClone(r.rules), options: structuredClone(r.options), sample: sample ?? null,
      continueAfterIntentUnmet: false, outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    },
  }
  return { runId: `test-fixture-${digestOf(identity).slice(0, 16)}`, identity, resolved: r,
    effective: { damageScope: damageScopeOf(r), strict, strictSource: 'default', sample: sample ?? null, continueAfterIntentUnmet: false } }
}

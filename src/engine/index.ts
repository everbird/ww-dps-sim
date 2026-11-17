// DD-10 §5：分析层公开入口；仅显式导出确需的执行、查询、诊断与纯函数。
export { ASSUMPTIONS, type AdjustPath, type TrackedId } from './assumptions'
export { basisOf, damageShareByTag, sameDamageScope, scopeMismatchOf, scopeShortLabel, truncationRemainsText, type Basis, type BasisResult, type BasisStatus, type ScopeMismatch, usableBasis, usableSteady } from './basis'
export { compileMembers, compileRotation, type CompileMember } from './compile'
export { type HitRecord } from './context'
export { ALL_DIAG, checkLedgerClosure, crossCheckLedger, type DiagSink, type EventMeta, type ResourceLedgerEntry } from './diagnostics'
export { canonicalJson, digestOf } from './digest'
export { battleFrameOf, hitValue } from './event-util'
export { accumulate, composeStat, computeHit, matchesFilter, type HitContext } from './formula'
export { checkLog } from './invariants'
export { round, roundTo, snap9 } from './num'
export { PROPOSITIONS, type Binding, type Candidate, type CandidateChange, type Evidence, type EvidencePurpose, type Proposition, type ScenarioFeature } from './propositions'
export { statesAt, type EventHandle } from './query'
export { echoSpecies, resolveScenario, ResolveError, setPieces } from './resolve'
export { runSeeds } from './rng'
export { damageScopeOf, prepareRun, runForInspection, runPrepared, type InspectOptions } from './run'
export { type DamageScope, type InterventionRecord, type PreparedRun, type RunCompletion, type RunEnvironment, type RunIdentity, type RunOverrides, type RunStatus } from './run-types'
export { buffUptimeDetail } from './summary'
export { outroOf } from './switch'
export { type CommandRef, type HitEvent, type ResolvedMember, type ResolvedScenario, type SimEvent, type SimResult, type SimState, type StaticPanel, type WaitCode, type ZoneAccumulator } from './types'
export { INTENDED, INTENT_WAITS } from './wait-codes'
// DD-10 §5：对外查询能力显式列出，内部执行体与可变上下文不批量导出。query.ts 里只有 replayTo 不导出：它交出的前缀 / 终态带着
// 可变的运行体（Sim、SimState 本体），分析层要状态走 stateAt / statesAt / terminalState 的只读投影（viewOf）。其余函数与结果类型都在这里
export {
  stateAt, statesAndResult, terminalState, terminalStateOf, viewOf, eventsBySeq, eventsBetween, openProbe, commandCheck, rawActionCheck,
  whyDidEventNotTrigger, wouldHypotheticalEventTrigger, explainEvent, EXPLAIN_DIAG, diffRuns,
  type CommandCheck, type DiffTarget, type EventExplanation, type EventRecord, type HypotheticalEvent, type HypotheticalTriggerCheck,
  type ProbeSession, type QueryError, type QueryResult, type RunDiff, type RunDiffExtra, type StateAt, type StateView, type StopPoint,
  type TerminalStateAt, type TriggerCheck, type TriggerOutcome, type TriggerTarget,
} from './query'
export { snapshotAt, snapshotsAt, resumeFrom, MemorySnapshotCache, type Snapshot, type SnapshotCache } from './snapshot'
export { RULE_POINTS } from './rule-points'
export { envelope, fromWire, scopeUnsupported, toWire, WIRE_SCHEMA_VERSION, type CapabilityDisclosure, type JsonValue, type QueryEnvelope, type WireSchema } from './wire'

// src/cli/run-env.ts —— 命令行采集运行身份里纯库拿不到的部分（DD-01 §4 T01-8；架构 §9）：提交号、工作区内容指纹、xlsx 的 sha256 与资源版本。
// 引擎不读盘、不调 git（tests/layering.test.ts 的规则 2），由这里采好经 prepareRun 的 overrides.environment 传进去。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { RunEnvironment } from '../engine/run-types'

/** 影响运行结果的路径：这些地方有没提交的改动时，提交号说明不了跑的是什么，另算内容指纹 */
const TRACKED = ['src/engine', 'src/analysis', 'src/data', 'data/curated', 'scenarios', 'inventory', 'data/xlsx-versions.json']
/** data/generated 不进 git、逐个文件算太慢：拿构建写的 meta.json 代表它（里面有 xlsx 的 sha256 与构建时刻） */
const GENERATED_META = 'data/generated/meta.json'

const sha256 = (x: string | Buffer): string => createHash('sha256').update(x).digest('hex')
const git = (root: string, args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })

/** 有改动的、已暂存的、未跟踪的文件（相对仓库根的路径）；不在仓库里返回 null */
function dirtyFiles(root: string): string[] | null {
  let out: string
  try {
    out = git(root, ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...TRACKED])
  } catch {
    return null
  }
  const files: string[] = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!
    if (entry.length < 4) continue
    files.push(entry.slice(3))
    if (entry[0] === 'R' || entry[0] === 'C') files.push(parts[++i]!)       // 改名、复制：后面跟着原路径，两头都算
  }
  return [...new Set(files)].sort()
}

/** 工作区内容指纹：逐个取"路径 + 内容的 sha256"（删掉的记 deleted），连同 data/generated/meta.json 的，对整张表再取 sha256 */
function fingerprint(root: string, files: readonly string[]): string {
  const row = (path: string): string => {
    const abs = join(root, path)
    return `${path}\t${existsSync(abs) && statSync(abs).isFile() ? sha256(readFileSync(abs)) : 'deleted'}`
  }
  return sha256([...files.map(row), row(GENERATED_META)].join('\n'))
}

/** 采集一次；root 是仓库根（缺省当前目录，pnpm 的脚本都从仓库根跑）。不在 git 仓库里时提交号记 'unknown'、不算指纹 */
export function collectRunEnvironment(root: string = process.cwd()): RunEnvironment {
  let gitCommit = 'unknown'
  try {
    gitCommit = git(root, ['rev-parse', 'HEAD']).trim() || 'unknown'
  } catch { /* 不在仓库里，或没装 git */ }
  const dirty = gitCommit === 'unknown' ? null : dirtyFiles(root)
  let xlsx: { sha256?: string; resourceVersion?: string } | undefined
  try {
    const list = JSON.parse(readFileSync(join(root, 'data/xlsx-versions.json'), 'utf8')) as { current?: string; versions?: { version: string; sha256?: string; resourceVersion?: string }[] }
    xlsx = list.versions?.find(v => v.version === list.current)
  } catch { /* 没有版本清单：这两项省略 */ }
  return {
    gitCommit,
    ...(dirty && dirty.length > 0 ? { contentFingerprint: fingerprint(root, dirty) } : {}),
    ...(xlsx?.sha256 ? { xlsxSha256: xlsx.sha256 } : {}),
    ...(xlsx?.resourceVersion ? { resourceVersion: xlsx.resourceVersion } : {}),
  }
}

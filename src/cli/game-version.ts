// src/cli/game-version.ts —— 当前声明的游戏版本（DD-08 §7、T08-7）：data/xlsx-versions.json 里 current 那份 xlsx 条目手填的 gameVersion。
// 它是观测与证据对照用的"现在的游戏版本"，不是 xlsx 的文件日期（GameData.version），也不是资源版本（resourceVersion）；不同身份的版本号不互相比大小
// （路线图 §5.4）。没写时返回 null。
import { readFileSync } from 'node:fs'

export function currentGameVersion(file = 'data/xlsx-versions.json'): string | null {
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as { current?: string; versions?: { version: string; gameVersion?: string }[] }
    return list.versions?.find(v => v.version === list.current)?.gameVersion ?? null
  } catch {
    return null
  }
}

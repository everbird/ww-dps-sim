// src/data/load.ts —— Node 侧加载 GameData：读 data/generated/*.json（zod 校验）与 data/curated/ 的手写模块，交给 buildGameData
// 引擎（src/engine）不引用这个文件；CLI 与测试用它。网页将来 fetch 生成文件后直接调用 buildGameData。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import type { BuffDefInput } from './buff.schema'
import type { CharacterModuleDef, EchoModule, EchoSetModule, WeaponModule } from './define'
import type { GameData } from './gamedata'
import {
  GenActionFileSchema, GenCharactersSchema, GenEchoSchema, GenEnemySchema, GenMetaSchema, GenWeaponSchema, type GenActionFile,
} from './generated.schema'
import { buildGameData } from './registry'
import { parseOrThrow } from './validate'

const ROOT = new URL('../../data/', import.meta.url)

/** 生成数据是否在本地（公开仓库不带 data/generated，需先 pnpm build:data） */
export const hasGenerated = (root: URL = ROOT): boolean => existsSync(new URL('generated/meta.json', root))

export async function loadGameData(root: URL = ROOT): Promise<GameData> {
  const gen = new URL('generated/', root)
  if (!existsSync(new URL('meta.json', gen))) throw new Error('没有 data/generated/meta.json：先运行 pnpm build:data')
  const read = <S extends z.ZodType>(schema: S, rel: string): z.output<S> =>
    parseOrThrow(schema, JSON.parse(readFileSync(new URL(rel, gen), 'utf8')), `data/generated/${rel}`)

  const characters = await importAll<CharacterModuleDef>(new URL('curated/characters/', root))
  const generatedChars = read(GenCharactersSchema, 'characters.json')
  // 只读用得到的动作文件：有角色模块的角色、它们并入的块、全部通用块
  const keys = new Set<string>(readdirSync(new URL('actions/', gen)).filter(f => f.startsWith('通用-')).map(f => f.replace(/\.json$/, '')))
  for (const m of characters) { keys.add(m.name); for (const k of m.mergeBlocks ?? []) keys.add(k) }
  const actions: Record<string, GenActionFile> = {}
  for (const k of keys) if (existsSync(new URL(`actions/${k}.json`, gen))) actions[k] = read(GenActionFileSchema, `actions/${k}.json`)

  const cur = new URL('curated/', root)
  return buildGameData(
    {
      meta: read(GenMetaSchema, 'meta.json'), characters: generatedChars, actions,
      weapons: read(z.array(GenWeaponSchema), 'weapons.json'),
      echoes: existsSync(new URL('echoes.json', gen)) ? read(z.array(GenEchoSchema), 'echoes.json') : [],
      enemies: read(z.array(GenEnemySchema), 'enemies.json'),
    },
    {
      characters,
      weapons: await importList<WeaponModule>(new URL('weapons.ts', cur)),
      echoes: await importList<EchoModule>(new URL('echoes.ts', cur)),
      echoSets: await importList<EchoSetModule>(new URL('echo-sets.ts', cur)),
      envBuffs: await importList<BuffDefInput>(new URL('env-buffs.ts', cur)),
    },
  )
}

/** 目录里每个 .ts 文件的默认导出 */
async function importAll<T>(dir: URL): Promise<T[]> {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(f => f.endsWith('.ts')).sort()
  return Promise.all(files.map(async f => ((await import(new URL(f, dir).href)) as { default: T }).default))
}

/** 单个文件默认导出的数组；文件不存在时为空 */
async function importList<T>(file: URL): Promise<T[]> {
  if (!existsSync(file)) return []
  return ((await import(file.href)) as { default: T[] }).default
}

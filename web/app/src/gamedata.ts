// web/app/src/gamedata.ts —— 浏览器里装配 GameData：同 src/data/load.ts，只是文件由 Vite 的 import.meta.glob 读
// （生成文件按需加载，动作文件只读用得到的块）。没有 data/generated 时报"先 pnpm build:data"。
import { z } from 'zod'
import type { CharacterModuleDef } from '../../../src/data/define'
import type { GameData } from '../../../src/data/gamedata'
import {
  GenActionFileSchema, GenCharactersSchema, GenEchoSchema, GenEchoStatsSchema, GenEnemySchema, GenMetaSchema, GenTuneBreakSchema,
  GenWeaponSchema, type GenActionFile,
} from '../../../src/data/generated.schema'
import { buildGameData } from '../../../src/data/registry'
import { parseOrThrow } from '../../../src/data/validate'
import echoSets from '../../../data/curated/echo-sets'
import echoes from '../../../data/curated/echoes'
import weapons from '../../../data/curated/weapons'

const characters = Object.values(import.meta.glob<{ default: CharacterModuleDef }>('../../../data/curated/characters/*.ts', { eager: true }))
  .map(m => m.default)
const gen = import.meta.glob<unknown>('../../../data/generated/*.json', { import: 'default' })
const actionFiles = import.meta.glob<unknown>('../../../data/generated/actions/*.json', { import: 'default' })

const GEN = '../../../data/generated/'

async function read<S extends z.ZodType>(schema: S, name: string, optional = false): Promise<z.output<S> | undefined> {
  const load = gen[`${GEN}${name}`]
  if (!load) {
    if (optional) return undefined
    throw new Error(`没有 data/generated/${name}：先在仓库里运行 pnpm build:data，再重开网页`)
  }
  return parseOrThrow(schema, await load(), `data/generated/${name}`)
}

export async function loadGameData(): Promise<GameData> {
  const keys = new Set<string>()
  for (const path of Object.keys(actionFiles)) {
    const k = path.slice(`${GEN}actions/`.length, -'.json'.length)
    if (k.startsWith('通用-')) keys.add(k)
  }
  for (const m of characters) { keys.add(m.name); for (const k of m.mergeBlocks ?? []) keys.add(k) }
  const actions: Record<string, GenActionFile> = {}
  for (const k of keys) {
    const load = actionFiles[`${GEN}actions/${k}.json`]
    if (load) actions[k] = parseOrThrow(GenActionFileSchema, await load(), `data/generated/actions/${k}.json`)
  }
  const echoStats = await read(GenEchoStatsSchema, 'echo-stats.json', true)
  const tuneBreak = await read(GenTuneBreakSchema, 'tune-break.json', true)
  return buildGameData(
    {
      meta: (await read(GenMetaSchema, 'meta.json'))!, characters: (await read(GenCharactersSchema, 'characters.json'))!, actions,
      weapons: (await read(z.array(GenWeaponSchema), 'weapons.json'))!,
      echoes: (await read(z.array(GenEchoSchema), 'echoes.json', true)) ?? [],
      ...(echoStats ? { echoStats } : {}),
      enemies: (await read(z.array(GenEnemySchema), 'enemies.json'))!,
      ...(tuneBreak ? { tuneBreak } : {}),
    },
    { characters, weapons, echoes, echoSets, envBuffs: [] },
  )
}

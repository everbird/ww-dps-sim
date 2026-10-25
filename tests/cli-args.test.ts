// tests/cli-args.test.ts —— 命令行参数 argsOf：--md 后面漏写输出文件时报错，不把下一个场景当输出路径覆盖
import { expect, test } from 'vitest'
import { argsOf } from '../src/cli/format'

test('argsOf：--md 取 .md 文件，后面跟的是场景时报错', () => {
  expect(argsOf(['a.yaml', '--md', 'out.md', '--'], ['--md'])).toEqual({ pos: ['a.yaml'], opt: { md: 'out.md' } })
  expect(() => argsOf(['--md', 'scenarios/a.yaml', 'b.yaml'], ['--md'])).toThrow(/\.md/)
})

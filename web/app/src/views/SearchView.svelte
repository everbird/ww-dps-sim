<!-- 轴搜索：在循环轴上挪动 / 去掉 / 对调 / 插入动作，每种完整跑一遍、按稳态 DPS 排名（同 pnpm search，TD-10 §6.1）；
     另一种是按套路排轴（同 pnpm plan，TD-10 §6.2 ④′，PlanView）。
     比原轴好的改法是要拿实战核对的假设；可以另存成场景（只换循环轴），再去"对比"看差在哪 -->
<script lang="ts">
  import { withRotation } from '../../../../src/data/scenario-text'
  import { FAILURE_LABEL, type Candidate } from '../../../../src/engine/search'
  import { call } from '../api'
  import { find, ofKind, saveAs } from '../docs.svelte'
  import { teamOf } from '../peek'
  import { fmt, pct2, signed } from '../fmt'
  import type { Requests } from '../protocol'
  import PlanView from './PlanView.svelte'

  let { name = $bindable(), oncompare }: { name: string; oncompare: (base: string, other: string) => void } = $props()
  let mode = $state<'local' | 'plan'>('local')
  const list = $derived(ofKind('scenario'))
  const team = $derived(teamOf(find('scenario', name)?.text ?? ''))
  const split = (s: string) => s.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean)
  let move = $state('')                     // 空 = 缺省：声骸技能 Q
  let drop = $state('')
  let insert = $state('')
  let swap = $state(false)
  let only = $state('')                     // 空 = 三人都改
  let rounds = $state(1)
  let busy = $state(false)
  let err = $state<string | null>(null)
  let out = $state<Requests['search']['res'] | null>(null)
  let ran = $state<{ name: string; text: string } | null>(null)   // 结果是按哪份场景的哪个原文跑的（另存用）
  let saved = $state<Map<Candidate, string>>(new Map())

  async function run() {
    const d = find('scenario', name)
    if (!d) return
    busy = true; err = null
    try {
      out = await call('search', {
        scenario: { name: d.name, text: d.text }, move: move.trim() ? split(move) : null, drop: split(drop), swap, insert: split(insert),
        chars: only ? [only] : [], rounds, beam: 3, maxRuns: 500, top: 20,
      })
      ran = { name: d.name, text: d.text }
      saved = new Map()
    } catch (e) { err = (e as Error).message; out = null }
    busy = false
  }

  /** 另存成场景：其余照原文，只换循环轴；返回新名字（存过的不再存） */
  function save(c: Candidate): string {
    const had = saved.get(c)
    if (had || !out || !ran) return had ?? ''
    const head = `# 轴搜索（网页）从 ${ran.name} 改来：${c.steps.join('；再 ')}\n`
    const n = saveAs('scenario', `${ran.name.replace(/\.yaml$/, '')}-搜索`, head + withRotation(ran.text, out.base.lines, c.lines))
    saved = new Map(saved).set(c, n)
    return n
  }

  const loop = (c: Candidate) => (c.loopSecs !== null ? `${c.loopSecs.toFixed(2)} 秒` : '—')
  // 结果一样的（DPS 与每轮时长都相同）合成一行，同命令行
  // 原轴按排名认（Worker 传回来的是副本，不能按引用比）
  const groups = $derived.by(() => {
    if (!out) return []
    const baseRank = out.rankOfBase
    const g: { c: Candidate; rank: number; same: number; isBase: boolean }[] = []
    out.results.forEach((c, i) => {
      const last = g.at(-1), isBase = i + 1 === baseRank
      if (last && !last.isBase && !isBase && Math.abs(last.c.dps! - c.dps!) < 1e-6 && last.c.loopSecs === c.loopSecs) last.same++
      else g.push({ c, rank: i + 1, same: 0, isBase })
    })
    return g
  })
  const failed = $derived(out ? Object.entries(out.failures).sort((a, b) => b[1] - a[1]) : [])
  const STOP = { rounds: '跑满轮数', noBetter: '这一轮没有更好的，停', maxRuns: '仿真次数到上限，停' }
</script>

<div class="modes" role="tablist">
  <button type="button" role="tab" aria-selected={mode === 'local'} class:on={mode === 'local'} onclick={() => (mode = 'local')}>局部改动（挪动 / 去掉 / 对调 / 插入）</button>
  <button type="button" role="tab" aria-selected={mode === 'plan'} class:on={mode === 'plan'} onclick={() => (mode = 'plan')}>按套路排轴</button>
</div>

{#if mode === 'plan'}
  <PlanView bind:name {oncompare} />
{:else}
<section class="card pad">
  <div class="row">
    <label>场景 <select bind:value={name}>{#each list as d (d.name)}<option>{d.name}</option>{/each}</select></label>
    <label>只改 <select bind:value={only}><option value="">三人都改</option>{#each team as c}<option>{c}</option>{/each}</select></label>
    <label>轮数 <select bind:value={rounds}>{#each [1, 2, 3] as k}<option value={k}>{k}</option>{/each}</select></label>
    <button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '搜索中…（每种完整跑一遍，十几秒到一两分钟）' : '搜索'}</button>
  </div>
  <div class="row opts">
    <label>挪动 <input bind:value={move} placeholder="缺省：声骸技能 Q" size="18" /></label>
    <label>试着去掉 <input bind:value={drop} placeholder="如 A5" size="10" /></label>
    <label>插入 <input bind:value={insert} placeholder="如 A1~、谐度破坏?" size="18" /></label>
    <label><input type="checkbox" bind:checked={swap} /> 对调相邻的两个动作</label>
  </div>
  <p class="muted">只改循环轴，启动轴不动；几个动作用逗号分开。比原轴好的改法是"游戏里也该更好"的假设，要进游戏核对（TD-10 §6.1）。</p>
  {#if err}<pre class="error">{err}</pre>{/if}
</section>

{#if out}
  <section class="card pad">
    <dl class="stats">
      <div><dt>原轴 · {out.label}</dt><dd>{fmt(out.base.dps!)} <small>每轮 {loop(out.base)}</small></dd></div>
      <div><dt>最好</dt><dd class:up={out.results[0]!.dps! > out.base.dps! + 1e-6}>{signed(out.results[0]!.dps! / out.base.dps! - 1, pct2)}</dd></div>
      <div><dt>原轴排第</dt><dd>{out.rankOfBase} / {out.total}</dd></div>
    </dl>
    <p class="muted">
      试了 {out.tried} 种：跑通 {out.total - 1} 种{#if failed.length}，跑不通 {failed.reduce((a, [, n]) => a + n, 0)} 种（{failed.map(([k, n]) => `${FAILURE_LABEL[k] ?? k} ${n}`).join('、')}）{/if}；
      仿真 {out.runs} 次，{out.secs.toFixed(1)} 秒；{STOP[out.stoppedBy]}（{out.rounds} 轮）
    </p>
  </section>
  <section class="card pad">
    <h2>排名（前 {out.results.length} 条）</h2>
    <div class="tablebox"><table>
      <thead><tr><th class="r">排名</th><th class="r">DPS</th><th class="r">变化</th><th class="r">每轮</th><th>改法</th><th></th></tr></thead>
      <tbody>
        {#each groups as g (g.c)}
          {@const isBase = g.isBase}
          {@const d = g.c.dps! / out.base.dps! - 1}
          <tr class:base={isBase}>
            <td class="r">{g.rank}{#if g.same}–{g.rank + g.same}{/if}</td>
            <td class="r">{fmt(g.c.dps!)}</td>
            <td class="r" class:up={!isBase && d > 1e-6} class:down={!isBase && d < -1e-6}>{isBase ? '原轴' : signed(d, pct2)}</td>
            <td class="r">{loop(g.c)}</td>
            <td class="steps">
              {#if !isBase}{g.c.steps.join(' → 再 ')}{/if}
              {#if g.same}<span class="muted">（另有 {g.same} 种结果相同）</span>{/if}
              {#if g.c.introMissed > out.base.introMissed}<span class="warn">写了变奏没变奏 {g.c.introMissed} 处，轴可能有问题</span>{/if}
            </td>
            <td class="act">
              {#if !isBase}
                {#if saved.get(g.c)}<span class="muted">已存 {saved.get(g.c)}</span>{:else}<button type="button" onclick={() => save(g.c)}>另存成场景</button>{/if}
                <button type="button" onclick={() => oncompare(ran!.name, save(g.c))}>和原轴对比</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table></div>
    <p class="muted">另存的场景在"场景"页的列表里（存在本浏览器），只换了循环轴，改了的行注明"轴搜索改的"；要留下来就下载后放回仓库。</p>
  </section>
{/if}
{/if}

<style>
  .modes { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .modes button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .opts { margin-top: 8px; }
  .steps { white-space: normal; min-width: 260px; }
  .act { display: flex; gap: 6px; }
  .base td { background: var(--grid); }
  .warn { color: var(--wait); margin-left: 6px; }
</style>

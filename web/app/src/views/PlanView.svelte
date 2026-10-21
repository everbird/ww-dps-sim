<!-- 按套路排轴（同 pnpm plan，TD-10 §6.2 ④′）：轴里同一角色的一行当套路，重新排先后（次数可变、自动生成套路可选），
     或改排启动轴。比原轴好的是要拿实战核对的假设；可以另存成场景（只换循环轴 / 启动轴），再去"对比"看差在哪 -->
<script lang="ts">
  import { parse } from 'yaml'
  import { withOpening, withRotation } from '../../../../src/data/scenario-text'
  import { FAILURE_LABEL } from '../../../../src/engine/search'
  import { call } from '../api'
  import { find, ofKind, saveAs } from '../docs.svelte'
  import { fmt, pct2, signed } from '../fmt'
  import type { Requests } from '../protocol'

  let { name = $bindable(), oncompare }: { name: string; oncompare: (base: string, other: string) => void } = $props()
  const list = $derived(ofKind('scenario'))
  let opening = $state(false)
  let width = $state(8)
  let vary = $state(0)
  let gen = $state(false)
  let busy = $state(false)
  let err = $state<string | null>(null)
  let out = $state<Requests['plan']['res'] | null>(null)
  let ran = $state<{ name: string; text: string } | null>(null)
  let saved = $state<Map<number, string>>(new Map())

  async function run() {
    const d = find('scenario', name)
    if (!d) return
    busy = true; err = null
    try {
      out = await call('plan', { scenario: { name: d.name, text: d.text }, opening, width, vary, gen })
      ran = { name: d.name, text: d.text }
      saved = new Map()
    } catch (e) { err = (e as Error).message; out = null }
    busy = false
  }

  // 两种结果摊成同一种行，表格共用
  type Row = { routines: string[]; counts: Record<string, number>; lines: string[]; dps: number; extra: string; isRef: boolean; same: number; introMissed: number }
  const rows = $derived.by((): Row[] => {
    if (!out) return []
    if (out.mode === 'rotation') return out.result.leaves.map(l => ({ ...l, extra: l.loopSecs !== null ? `${l.loopSecs.toFixed(2)} 秒` : '—' }))
    return out.result.leaves.map(l => ({ ...l, introMissed: 0, extra: `稳态 ${l.steady !== null ? fmt(l.steady) : '—'} · 启动 ${l.openingSecs.toFixed(2)} 秒` }))
  })
  const refDps = $derived(!out ? 0 : out.result.ref.dps)
  const library = $derived(out?.result.library ?? [])
  const tag = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : i < 52 ? String.fromCharCode(97 + i - 26) : String(i + 1))
  const letter = (line: string) => tag(library.findIndex(l => l.line === line))
  const countText = (c: Record<string, number>) => Object.entries(c).map(([line, d]) => `${d > 0 ? '+' : '−'}${Math.abs(d) > 1 ? Math.abs(d) : ''}${letter(line)}`).join(' ')
  const failed = $derived(out ? Object.entries(out.result.failures).sort((a, b) => b[1] - a[1]) : [])
  const runs = $derived(!out ? 0 : out.mode === 'rotation' ? out.result.prefixRuns : out.result.runs)
  const FAIL: Record<string, string> = { ...FAILURE_LABEL, timeout: '等超时', introMissed: '写了变奏没变奏', noLoop: '没跑完一轮' }

  /** 另存成场景：其余照原文，只换循环轴 / 启动轴；返回新名字（存过的不再存） */
  function save(i: number): string {
    const had = saved.get(i)
    const r = rows[i]
    if (had || !out || !ran || !r) return had ?? ''
    const changed = countText(r.counts)
    const what = out.mode === 'opening' ? '启动轴' : '循环轴'
    const head = `# 按套路排${what}（网页）从 ${ran.name} 改来：顺序 ${r.routines.map(letter).join(' ')}${changed ? `（次数 ${changed}）` : ''}，${signed(r.dps / refDps - 1, pct2)}\n`
    const raw = parse(ran.text) as { rotation?: (string | null)[]; opening?: (string | null)[] }
    const base = (k: 'rotation' | 'opening') => (raw[k] ?? []).map(l => l ?? '')
    const body = out.mode === 'opening'
      ? withOpening(ran.text, base('opening'), r.lines)
      : withRotation(ran.text, base('rotation'), r.lines, '按套路排轴改的')
    const n = saveAs('scenario', `${ran.name.replace(/\.yaml$/, '')}-${out.mode === 'opening' ? '排启动轴' : '排轴'}`, head + body)
    saved = new Map(saved).set(i, n)
    return n
  }
</script>

<section class="card pad">
  <div class="row">
    <label>场景 <select bind:value={name}>{#each list as d (d.name)}<option>{d.name}</option>{/each}</select></label>
    <label>排 <select bind:value={opening}><option value={false}>循环轴</option><option value={true}>启动轴</option></select></label>
    <label>宽度 <select bind:value={width}>{#each [3, 6, 8, 12, 16] as k}<option value={k}>{k}</option>{/each}</select></label>
    <label>次数 <select bind:value={vary}><option value={0}>不变</option><option value={1}>±1</option></select></label>
    <label><input type="checkbox" bind:checked={gen} /> 自动生成套路</label>
    <button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '排轴中…（每个前缀跑仿真，几十秒到几分钟）' : '排轴'}</button>
  </div>
  <p class="muted">
    轴里同一角色的一行当一个套路，重新排先后；场景里写的 <code>search.routines</code> 也一起排。排循环轴按稳态比，排启动轴（循环轴不动）按整个窗口比。
    次数 ±1、自动生成套路会慢很多，先用小的宽度。比原轴好的是"游戏里也该更好"的假设，要进游戏核对（TD-10 §6.2）。
  </p>
  {#if err}<pre class="error">{err}</pre>{/if}
</section>

{#if out}
  <section class="card pad">
    <dl class="stats">
      <div><dt>原{out.mode === 'opening' ? '启动轴 · 整个窗口' : '轴 · 稳态'}</dt><dd>{fmt(refDps)}</dd></div>
      <div><dt>最好</dt><dd class:up={(rows[0]?.dps ?? 0) > refDps + 1e-6}>{rows[0] ? signed(rows[0].dps / refDps - 1, pct2) : '—'}</dd></div>
      <div><dt>原轴排第</dt><dd>{out.result.refRank ?? '—'} / {rows.length}</dd></div>
    </dl>
    <p class="muted">
      仿真 {runs} 次，{out.secs.toFixed(1)} 秒{#if failed.length}；跑不通：{failed.map(([k, n]) => `${FAIL[k] ?? k} ${n}`).join('、')}{/if}
    </p>
    <details>
      <summary>套路 {library.length} 种（另加 {library.filter(l => l.added).length}）</summary>
      <ul class="lib">{#each library as l, i (l.line)}<li><b>{tag(i)}</b> {l.line}{#if l.count > 1} ×{l.count}{/if}{#if l.added} <span class="muted">（另加）</span>{/if}</li>{/each}</ul>
    </details>
  </section>
  <section class="card pad">
    <h2>排名</h2>
    <div class="tablebox"><table>
      <thead><tr><th class="r">排名</th><th class="r">DPS</th><th class="r">变化</th><th>{out.mode === 'opening' ? '稳态 · 启动轴' : '每轮'}</th><th>顺序</th><th></th></tr></thead>
      <tbody>
        {#each rows as r, i (i)}
          {@const d = r.dps / refDps - 1}
          {@const changed = countText(r.counts)}
          <tr class:base={r.isRef}>
            <td class="r">{i + 1}</td>
            <td class="r">{fmt(r.dps)}</td>
            <td class="r" class:up={!r.isRef && d > 1e-6} class:down={!r.isRef && d < -1e-6}>{r.isRef ? '原轴' : signed(d, pct2)}</td>
            <td>{r.extra}</td>
            <td class="steps" title={r.lines.join('\n')}>
              {r.routines.map(letter).join(' ')}
              {#if changed}<span class="muted">（次数 {changed}）</span>{/if}
              {#if r.same}<span class="muted">（另有 {r.same} 种写法结果相同）</span>{/if}
              {#if r.introMissed}<span class="warn">写了变奏没变奏 {r.introMissed} 处</span>{/if}
            </td>
            <td class="act">
              {#if !r.isRef}
                {#if saved.get(i)}<span class="muted">已存 {saved.get(i)}</span>{:else}<button type="button" onclick={() => save(i)}>另存成场景</button>{/if}
                <button type="button" onclick={() => oncompare(ran!.name, save(i))}>和原轴对比</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table></div>
    <p class="muted">鼠标停在"顺序"上看写成的轴。另存的场景在"场景"页的列表里（存在本浏览器），改了的行注明"按套路排轴改的"。</p>
  </section>
{/if}

<style>
  .steps { white-space: normal; min-width: 220px; }
  .act { display: flex; gap: 6px; }
  .base td { background: var(--grid); }
  .warn { color: var(--wait); margin-left: 6px; }
  .lib { margin: 6px 0 0; padding-left: 0; list-style: none; columns: 2; font-size: 13px; }
  .lib b { display: inline-block; min-width: 1.5em; }
</style>

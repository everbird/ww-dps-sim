<!-- 声骸库存择优：从库存里给一个角色挑 5 件（同 pnpm optimize，TD-13） -->
<script lang="ts">
  import { call } from '../api'
  import { copyText } from '../clip'
  import { find, ofKind } from '../docs.svelte'
  import { setsOf, teamOf } from '../peek'
  import Editor from '../Editor.svelte'
  import { fmt, pct, pct2, signed, stats } from '../fmt'
  import type { Requests } from '../protocol'

  let { name = $bindable() }: { name: string } = $props()
  const list = $derived(ofKind('scenario'))
  const team = $derived(teamOf(find('scenario', name)?.text ?? ''))
  let char = $state('')
  $effect(() => { if (!team.includes(char)) char = team[0] ?? '' })
  let inv = $state(ofKind('inventory')[0]?.name ?? '')
  let top = $state(5)
  let keep = $state(8)
  let set = $state('')
  const setList = $derived(setsOf(find('inventory', inv)?.text ?? ''))
  let includeTeam = $state(false)
  let busy = $state(false)
  let err = $state<string | null>(null)
  let out = $state<Requests['optimize']['res'] | null>(null)
  let copied = $state<'ok' | 'fail' | null>(null)

  async function run() {
    const d = find('scenario', name), i = find('inventory', inv)
    if (!d || !i || !char) return
    busy = true; err = null; copied = null
    try {
      out = await call('optimize', {
        scenario: { name: d.name, text: d.text }, inventory: { name: i.name, text: i.text }, char, top, keep, set: set.trim() || null, includeTeam,
      })
    } catch (e) { err = (e as Error).message; out = null }
    busy = false
  }
  async function copy() {
    if (out) copied = (await copyText(out.yaml)) ? 'ok' : 'fail'
  }
</script>

<div class="split">
  <section class="card pad side">
    <div class="row">
      <label>场景 <select bind:value={name}>{#each list as d (d.name)}<option>{d.name}</option>{/each}</select></label>
      <label>角色 <select bind:value={char}>{#each team as c}<option>{c}</option>{/each}</select></label>
    </div>
    <Editor kind="inventory" bind:name={inv} label="库存" rows={16} />
    <div class="row">
      <label>列出 <input type="number" min="1" max="20" bind:value={top}> 套</label>
      <label>预筛每类留 <input type="number" min="2" max="30" bind:value={keep}> 件</label>
    </div>
    <div class="row">
      <label>5 件套 <input type="text" placeholder="沿用现在的" bind:value={set} size="10" list="sets"><datalist id="sets">{#each setList as x}<option value={x}></option>{/each}</datalist></label>
      <label class="check"><input type="checkbox" bind:checked={includeTeam}> 也拿队友身上的</label>
    </div>
    <div class="row">
      <button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '搜索中…（库存大时要十几秒）' : '择优'}</button>
    </div>
    <p class="muted">首位声骸不变（轴里的 Q 是它的技能），套装件数不少于现在的；估计用快速重算，排名看完整仿真（TD-13）。</p>
    {#if err}<pre class="error">{err}</pre>{/if}
  </section>

  <div class="results">
    {#if out}
      <section class="card pad">
        <dl class="stats">
          <div><dt>现在 · {out.current.label}</dt><dd>{fmt(out.current.dps)}</dd></div>
          <div><dt>首位</dt><dd class="txt">{out.main}</dd></div>
          <div><dt>套装</dt><dd class="txt">{Object.entries(out.plan).map(([s, n]) => `${s} ≥ ${n}`).join('、') || '不限'}</dd></div>
          <div><dt>可用 / 估计 / 完整仿真</dt><dd class="txt">{out.pool} 件 / {fmt(out.evaluated)} 套 / {out.verified} 套 · {out.secs.toFixed(1)} 秒</dd></div>
        </dl>
        {#each out.notes as n}<p class="muted">提示：{n}</p>{/each}
      </section>
      {#each out.builds as b, i}
        {@const p = out.panels[i]!}
        <section class="card pad build">
          <h2>第 {i + 1} 套{#if b.current}<span class="tag now">就是现在这套</span>{/if} <span class="num">DPS {fmt(b.dps!)}</span>
            <span class="num" class:up={b.dps! > out.current.dps + 0.5} class:down={b.dps! < out.current.dps - 0.5}>{signed(b.dps! - out.current.dps)}（{signed((b.dps! - out.current.dps) / out.current.dps, pct2)}）</span>
            <span class="muted num">估计 {fmt(b.est)} · 攻击 {fmt(p.atk)} · 暴击 {pct(p.critRate)} · 暴伤 {pct(p.critDamage)} · 共鸣效率 {pct(p.energyRegen)}</span>
          </h2>
          <ol>
            {#each b.pieces as x (x.id)}
              <li><b>{x.name}</b> <span class="tag">{x.cost}C</span> <span class="tag">{x.set}</span> <span class="id">{x.id}</span>{#if x.owner && x.owner !== out.char}<span class="tag warn">在 {x.owner} 身上</span>{/if}
                <div class="muted">主 {stats(x.main)}；副 {stats(x.subs) || '无'}</div></li>
            {/each}
          </ol>
        </section>
      {/each}
      {#if !out.builds.length}
        <section class="card pad"><p class="error">没有找到满足条件的组合：cost 合计 ≤ 12、首位是 {out.main}、套装 {Object.entries(out.plan).map(([s, n]) => `${s} ≥ ${n} 件`).join('、') || '不限'}。检查库存里这几类声骸够不够，或者"5 件套"写的套装名对不对。</p></section>
      {/if}
      {#if out.yaml}
        <section class="card pad">
          <div class="row"><h2>第 1 套写进场景（{out.char} 的 echoes）</h2><button type="button" onclick={copy}>{copied === 'ok' ? '已复制' : '复制'}</button>{#if copied === 'fail'}<span class="muted">浏览器不让复制，请长按或拖选下面的文本手动复制</span>{/if}</div>
          <pre class="code">{out.yaml}</pre>
        </section>
      {/if}
    {:else}
      <section class="card pad"><p class="empty">{busy ? '搜索中…' : '选场景、角色和库存，点"择优"。'}</p></section>
    {/if}
  </div>
</div>

<style>
  .split { display: grid; grid-template-columns: minmax(320px, 440px) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 960px) { .split { grid-template-columns: minmax(0, 1fr); } }
  .side { display: grid; gap: 10px; }
  .results { display: grid; gap: 16px; min-width: 0; }
  .results > :global(*) { min-width: 0; }
  input[type='number'] { width: 4.5em; }
  .build h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
  .build h2 .muted { font-size: 12px; font-weight: 400; }
  ol { margin: 8px 0 0; padding-left: 22px; display: grid; gap: 6px; font-size: 13px; }
  .tag { font-size: 11px; color: var(--muted); border: 1px solid var(--rule); border-radius: 4px; padding: 0 5px; }
  .tag.warn { color: var(--wait); border-color: var(--wait); }
  .tag.now { color: var(--accent); border-color: var(--accent); font-weight: 400; }
  .id { font-family: var(--mono); font-size: 11px; color: var(--faint); }
  .code { margin: 8px 0 0; font-family: var(--mono); font-size: 12px; background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 8px 10px; overflow-x: auto; user-select: all; -webkit-user-select: all; }
  dd.txt { font-family: var(--sans); font-size: 14px; }
</style>

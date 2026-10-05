<!-- 对比：两份场景比稳态 DPS，拆到角色、动作、buff 覆盖率与面板（同 pnpm compare，TD-10 §3） -->
<script lang="ts">
  import { call } from '../api'
  import { find, ofKind } from '../docs.svelte'
  import { fmt, pct, pct2, signed } from '../fmt'
  import type { Requests } from '../protocol'

  let { name }: { name: string } = $props()
  const list = $derived(ofKind('scenario'))
  let base = $state('')
  let other = $state('')
  $effect(() => { if (!base) base = name; if (!other) other = list.find(d => d.name !== name)?.name ?? name })
  let busy = $state(false)
  let err = $state<string | null>(null)
  let out = $state<Requests['compare']['res'] | null>(null)

  async function run() {
    const a = find('scenario', base), b = find('scenario', other)
    if (!a || !b) return
    busy = true; err = null
    try { out = await call('compare', { base: { name: a.name, text: a.text }, other: { name: b.name, text: b.text } }) } catch (e) { err = (e as Error).message; out = null }
    busy = false
  }
  const span = (x: { lo: number; hi: number }) => `${((x.hi - x.lo) / 60).toFixed(2)} 秒`
  const PANEL = [['atk', '攻击', fmt], ['critRate', '暴击', pct], ['critDamage', '暴伤', pct], ['energyRegen', '共鸣效率', pct]] as const
</script>

<section class="card pad">
  <div class="row">
    <label>基准 <select bind:value={base}>{#each list as d (d.name)}<option>{d.name}</option>{/each}</select></label>
    <label>对比 <select bind:value={other}>{#each list as d (d.name)}<option>{d.name}</option>{/each}</select></label>
    <button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '运行中…' : '对比'}</button>
    <span class="muted">在"场景"里改好、另存副本，再来这里比</span>
  </div>
  {#if err}<pre class="error">{err}</pre>{/if}
</section>

{#if out}
  <section class="card pad">
    <dl class="stats">
      <div><dt>基准 · {out.base.label} · {span(out.base)}</dt><dd>{fmt(out.base.dps)}</dd></div>
      <div><dt>对比 · {out.other.label} · {span(out.other)}</dt><dd>{fmt(out.other.dps)}</dd></div>
      <div><dt>差</dt><dd class:up={out.delta > 0} class:down={out.delta < 0}>{signed(out.delta)} <small>（{signed(out.pct, pct2)}）</small></dd></div>
    </dl>
  </section>
  <div class="grid">
    <section class="card pad">
      <h2>面板</h2>
      <div class="tablebox"><table>
        <thead><tr><th>角色</th>{#each PANEL as [, n]}<th class="r">{n}</th>{/each}</tr></thead>
        <tbody>{#each out.panels.base as p, i}<tr><td>{p.name}</td>{#each PANEL as [k, , f]}{@const a = p[k]}{@const b = out.panels.other[i]![k]}<td class="r" class:changed={a !== b}>{f(a)}{#if a !== b} → {f(b)}{/if}</td>{/each}</tr>{/each}</tbody>
      </table></div>
    </section>
    {#each [['分角色（每秒伤害）', out.byChar, fmt, 0.5], ['分动作（每秒伤害，前 12）', out.byAction.slice(0, 12), fmt, 0.5], ['buff 覆盖率（差 ≥ 1 个百分点）', out.uptime.filter(d => Math.abs(d.delta) >= 0.01).slice(0, 12), pct, 0]] as const as [title, rows, f, eps]}
      <section class="card pad">
        <h2>{title}</h2>
        {#if rows.filter(d => Math.abs(d.delta) > eps).length}
          <div class="tablebox"><table>
            <thead><tr><th></th><th class="r">基准</th><th class="r">对比</th><th class="r">差</th></tr></thead>
            <tbody>{#each rows.filter(d => Math.abs(d.delta) > eps) as d (d.key)}<tr><td>{d.key}</td><td class="r">{f(d.base)}</td><td class="r">{f(d.other)}</td><td class="r" class:up={d.delta > 0} class:down={d.delta < 0}>{signed(d.delta, f)}</td></tr>{/each}</tbody>
          </table></div>
        {:else}<p class="muted">没有差别。</p>{/if}
      </section>
    {/each}
  </div>
{/if}

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 16px; }
  .changed { color: var(--ink); font-weight: 500; }
</style>

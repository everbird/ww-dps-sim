<!-- 副词条边际：给一个角色各加一档副词条重跑，按 DPS 增加排序（同 pnpm marginal，TD-10 §4） -->
<script lang="ts">
  import { call } from '../api'
  import { find, ofKind, teamOf } from '../docs.svelte'
  import { fmt, pct2, signed, statValue } from '../fmt'
  import type { Requests } from '../protocol'

  let { name = $bindable() }: { name: string } = $props()
  const list = $derived(ofKind('scenario'))
  const team = $derived(teamOf(find('scenario', name)?.text ?? ''))
  let char = $state('')
  $effect(() => { if (!team.includes(char)) char = team[0] ?? '' })
  let tier = $state<'avg' | 'max' | 'min'>('avg')
  let busy = $state(false)
  let err = $state<string | null>(null)
  let out = $state<Requests['marginal']['res'] | null>(null)
  const max = $derived(out ? Math.max(1, ...out.rows.map(r => Math.abs(r.delta))) : 1)

  async function run() {
    const d = find('scenario', name)
    if (!d || !char) return
    busy = true; err = null
    try { out = await call('marginal', { scenario: { name: d.name, text: d.text }, char, tier }) } catch (e) { err = (e as Error).message; out = null }
    busy = false
  }
</script>

<section class="card pad">
  <div class="row">
    <label>场景 <select bind:value={name}>{#each list as d (d.name)}<option>{d.name}</option>{/each}</select></label>
    <label>角色 <select bind:value={char}>{#each team as c}<option>{c}</option>{/each}</select></label>
    <label>一档取 <select bind:value={tier}><option value="avg">各档平均</option><option value="max">最高档</option><option value="min">最低档</option></select></label>
    <button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '运行中…（约 14 次仿真）' : '计算'}</button>
  </div>
  <p class="muted">加在该角色最后一件声骸的副词条上，轴不变：共鸣效率只在原来要等能量时才有收益（TD-10 §4）。</p>
  {#if err}<pre class="error">{err}</pre>{/if}
</section>

{#if out}
  <section class="card pad">
    <h2>{char} · 基准 {out.label} DPS {fmt(out.dps)}</h2>
    <div class="tablebox"><table>
      <thead><tr><th>副词条</th><th class="r">一档</th><th class="r">DPS</th><th class="r">增加</th><th class="r">比例</th><th class="barcol"></th></tr></thead>
      <tbody>
        {#each out.rows as r (r.stat)}
          <tr>
            <td>{r.stat}</td><td class="r">+{statValue(r.stat, r.value)}</td><td class="r">{fmt(r.dps)}</td>
            <td class="r" class:up={r.delta > 0.5} class:down={r.delta < -0.5}>{signed(r.delta)}</td><td class="r">{signed(r.pct, pct2)}</td>
            <td class="barcol"><span class="bar" style:width="{(Math.max(0, r.delta) / max) * 100}%"></span></td>
          </tr>
        {/each}
      </tbody>
    </table></div>
  </section>
{/if}

<style>
  .barcol { width: 32%; min-width: 120px; }
  .bar { display: block; height: 8px; border-radius: 2px; background: var(--accent); }
</style>

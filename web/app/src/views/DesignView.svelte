<!-- 视图说明：A–F 几种时间轴视图的理念与优劣，右边是效果（2026-10，web/designs/）；"场景"页运行后也能切换这些视图 -->
<script lang="ts">
  import { call } from '../api'
  import { DESIGNS } from '../designs'
  import { find, ofKind } from '../docs.svelte'

  let { name = $bindable(), pick = $bindable() }: { name: string; pick: string } = $props()
  const list = $derived(ofKind('scenario'))
  const d = $derived(DESIGNS.find(x => x.id === pick) ?? DESIGNS[0]!)
  let html = $state<string | null>(null)
  let err = $state<string | null>(null)
  let busy = $state(false)
  // 全屏：效果盖满屏幕（手机、iPad 上看），Esc 或"退出全屏"回来
  let full = $state(false)
  $effect(() => { document.documentElement.classList.toggle('lock', full); return () => document.documentElement.classList.remove('lock') })

  async function load(file: string, scen: string) {
    const s = find('scenario', scen)
    if (!s) return
    busy = true; err = null
    try { html = (await call('design', { scenario: { name: s.name, text: s.text }, file })).html } catch (e) { err = (e as Error).message; html = null }
    busy = false
  }
  $effect(() => { load(d.file, name) })
  function openFull() {
    if (!html) return
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank')
  }
</script>

<div class="split">
  <aside class="card pad side">
    <label class="muted">场景 <select bind:value={name}>{#each list as s (s.name)}<option>{s.name}</option>{/each}</select></label>
    <div class="picks">
      {#each DESIGNS as x (x.id)}
        <button type="button" class:on={x.id === d.id} onclick={() => { pick = x.id; location.hash = `design-${x.id}` }}>
          <b>{x.name}</b><span>适合：{x.fits}</span>
        </button>
      {/each}
    </div>
    <section class="desc">
      <h2>{d.name}</h2>
      <p>{d.idea}</p>
      <h3>优点</h3>
      <ul>{#each d.pros as p}<li>{p}</li>{/each}</ul>
      <h3>不足</h3>
      <ul class="cons">{#each d.cons as p}<li>{p}</li>{/each}</ul>
    </section>
    <button type="button" onclick={openFull} disabled={!html}>在新标签页整页打开</button>
    {#if err}<pre class="error">{err}</pre>{/if}
  </aside>
  <section class="card result" class:full>
    {#if html}
      <div class="bar"><b>{d.name}</b><button type="button" onclick={() => (full = !full)} aria-pressed={full}>{full ? '退出全屏' : '全屏'}</button></div>
      <iframe title={d.name} srcdoc={html}></iframe>
    {:else}
      <p class="empty">{busy ? '生成中…' : '选一个设计。'}</p>
    {/if}
  </section>
</div>

<svelte:window onkeydown={e => { if (e.key === 'Escape' && full) full = false }} />

<style>
  .split { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 960px) { .split { grid-template-columns: minmax(0, 1fr); } }
  .side { display: grid; gap: 12px; position: sticky; top: 12px; }
  @media (max-width: 960px) { .side { position: static; } }
  .side > label { display: flex; align-items: center; gap: 8px; }
  .picks { display: grid; gap: 6px; }
  .picks button { text-align: left; display: grid; gap: 1px; padding: 8px 10px; background: var(--panel); }
  .picks button b { font-weight: 500; font-size: 14px; }
  .picks button span { font-size: 12px; color: var(--muted); }
  .picks button.on { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
  .desc h2 { margin: 4px 0 6px; }
  .desc h3 { margin: 10px 0 4px; font-size: 13px; color: var(--muted); font-weight: 500; }
  .desc p { margin: 0; font-size: 13px; line-height: 1.65; }
  .desc ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6; display: grid; gap: 2px; }
  .desc ul.cons li::marker { color: var(--alert); }
  .result { overflow: hidden; min-height: 400px; }
  iframe { width: 100%; border: 0; display: block; height: max(560px, calc(100dvh - 140px)); }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .bar b { font-weight: 500; }
  .result.full { position: fixed; inset: 0; z-index: 50; border: 0; border-radius: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .result.full iframe { height: 100%; }
</style>

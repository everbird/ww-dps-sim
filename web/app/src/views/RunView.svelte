<!-- 场景：编辑 YAML、运行，结果是时间轴网页（同 pnpm timeline，含分轮、分动作、等待、调试表） -->
<script lang="ts">
  import { call } from '../api'
  import { find } from '../docs.svelte'
  import Editor from '../Editor.svelte'
  import { fmt } from '../fmt'
  import type { Requests } from '../protocol'

  let { name = $bindable() }: { name: string } = $props()
  let busy = $state(false)
  let err = $state<string | null>(null)
  let out = $state<Requests['run']['res'] | null>(null)
  let frame = $state<HTMLIFrameElement>()
  let height = $state(900)

  async function run() {
    const d = find('scenario', name)
    if (!d) return
    busy = true; err = null
    try { out = await call('run', { scenario: { name: d.name, text: d.text } }) } catch (e) { err = (e as Error).message; out = null }
    busy = false
  }
  // 时间轴网页的高度跟着内容（srcdoc 同源，量得到）
  function fit() {
    const doc = frame?.contentDocument
    if (doc) height = Math.max(600, doc.documentElement.scrollHeight + 8)
  }
</script>

<div class="split">
  <section class="card pad side">
    <Editor kind="scenario" bind:name label="场景" rows={28} />
    <div class="actions">
      <button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '运行中…' : '运行'}</button>
      <span class="muted">Ctrl+Enter 也能运行</span>
    </div>
    {#if err}<pre class="error">{err}</pre>{/if}
    {#if out}
      <dl class="stats">
        <div><dt>{out.label}</dt><dd>{fmt(out.steady ?? out.dps)}</dd></div>
        <div><dt>整个窗口</dt><dd>{fmt(out.dps)}</dd></div>
      </dl>
      {#if out.error}<p class="error">运行报错（{out.error}）：日志保留到出错为止</p>{/if}
      {#if out.warnings.length}
        <details><summary>提示 {out.warnings.length} 条</summary><ul class="warn">{#each out.warnings as w}<li>{w}</li>{/each}</ul></details>
      {/if}
    {/if}
  </section>
  <section class="card result">
    {#if out}
      <iframe bind:this={frame} title="时间轴" srcdoc={out.html} style:height="{height}px" onload={fit}></iframe>
    {:else}
      <p class="empty">{busy ? '运行中…' : '选一个场景，点"运行"：结果是时间轴、分轮、分动作与调试表（同 pnpm timeline）。'}</p>
    {/if}
  </section>
</div>

<svelte:window onkeydown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() } }} />

<style>
  .split { display: grid; grid-template-columns: minmax(320px, 420px) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 960px) { .split { grid-template-columns: minmax(0, 1fr); } }
  .side { display: grid; gap: 10px; position: sticky; top: 12px; }
  @media (max-width: 960px) { .side { position: static; } }
  .actions { display: flex; align-items: center; gap: 10px; }
  .result { overflow: hidden; min-height: 300px; }
  iframe { width: 100%; border: 0; display: block; background: var(--paper); }
  .stats { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 0; }
  .stats dt { font-size: 12px; color: var(--muted); }
  .stats dd { margin: 0; font-family: var(--mono); font-size: 18px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .warn { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: var(--muted); }
  details summary { cursor: pointer; font-size: 13px; color: var(--muted); }
</style>

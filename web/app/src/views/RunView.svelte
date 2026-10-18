<!-- 场景：编辑 YAML、运行，结果是时间轴网页（同 pnpm timeline；原版含分轮、分动作、等待、调试表，A–D 见"视图说明"） -->
<script lang="ts">
  import { tick } from 'svelte'
  import { call } from '../api'
  import { DESIGNS } from '../designs'
  import { find, ofKind } from '../docs.svelte'
  import Editor from '../Editor.svelte'
  import { fmt } from '../fmt'
  import type { Requests } from '../protocol'
  import { ASSUMPTIONS, IMPACT_NAME, assumptionOf } from '../../../../src/engine/assumptions'

  let { name = $bindable() }: { name: string } = $props()
  let busy = $state(false)
  let err = $state<string | null>(null)
  let out = $state<Requests['run']['res'] | null>(null)
  // 上次运行的是哪份原文：编辑后提示"还没运行"。用 $state.raw：要原样发给 Worker（响应式代理对象不能 postMessage）
  let ran = $state.raw<{ name: string; text: string } | null>(null)
  const doc = $derived(find('scenario', name))
  const stale = $derived(!!out && !!doc && !!ran && (ran.name !== doc.name || ran.text !== doc.text))

  // 同一次运行换着视图看（Worker 缓存了仿真结果，切换不重跑）；记住上次选的视图与编辑器的收起
  // short：手机上按钮只写"原版"、字母，一行放得下
  const VIEWS = [{ id: 'classic', name: '原版（含调试表）', short: '原版' }, ...DESIGNS.map(d => ({ id: d.file, name: d.name, short: d.name.split(' ')[0]! }))]
  const load = (k: string, dflt: string) => { try { return localStorage.getItem(k) ?? dflt } catch { return dflt } }
  const save = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* 存不了就算了 */ } }
  let view = $state(VIEWS.some(v => v.id === load('wwdps.view', 'classic')) ? load('wwdps.view', 'classic') : 'classic')
  let wide = $state(load('wwdps.wide', '0') === '1')
  // 全屏：结果盖满屏幕（手机、iPad 上看时间轴；不用在小框里套着滚），Esc 或"退出全屏"回来
  let full = $state(false)
  $effect(() => { document.documentElement.classList.toggle('lock', full); return () => document.documentElement.classList.remove('lock') })
  let result = $state<HTMLElement>()

  async function run() {
    const d = find('scenario', name)
    if (!d) return
    busy = true; err = null
    const snapshot = { name: d.name, text: d.text }
    try { out = await call('run', { scenario: snapshot, view }); ran = snapshot } catch (e) { err = (e as Error).message; out = null }
    busy = false
    // 窄屏上结果在编辑器下面：结果还在屏幕外时滚过去
    await tick()
    if (out && result && result.getBoundingClientRect().top > innerHeight - 80) result.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function pick(v: string) {
    view = v; save('wwdps.view', v)
    if (out && ran) { busy = true; call('run', { scenario: ran, view }).then(r => { out = r }, e => { err = (e as Error).message }).finally(() => { busy = false }) }
  }
  function toggleWide() { wide = !wide; save('wwdps.wide', wide ? '1' : '0') }
  // 每次都适用的假设（总设计 T16）：不随场景变，列在"这次碰到的"后面
  const ALWAYS = ASSUMPTIONS.filter(a => !a.tracked)
</script>

<div class="split" class:wide>
  {#if !wide}
    <section class="card pad side">
      <Editor kind="scenario" bind:name label="场景" rows={26} />
      <div class="actions">
        <button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '运行中…' : '运行'}</button>
        <span class="muted kbd">Ctrl+Enter 也能运行</span>
      </div>
      {#if stale}<p class="stale">场景改过了，结果还是上次运行的；按"运行"更新</p>{/if}
      {#if err}<pre class="error">{err}</pre>{/if}
      {#if out}
        <dl class="stats">
          <div><dt>{out.label}</dt><dd>{fmt(out.steady ?? out.dps)}</dd></div>
          <div><dt>整个窗口</dt><dd>{fmt(out.dps)}</dd></div>
        </dl>
        {#if out.error}<p class="error">运行报错（{out.error}）：日志保留到出错为止</p>{/if}
        {#if out.alerts.length}
          <div class="alerts" role="alert"><b>轴可能有问题（{out.alerts.length} 处）：写了"变奏"的切人没变奏</b><ul>{#each out.alerts as w}<li>{w}</li>{/each}</ul></div>
        {/if}
        {#if out.warnings.length}
          <details><summary>提示 {out.warnings.length} 条</summary><ul class="warn">{#each out.warnings as w}<li>{w}</li>{/each}</ul></details>
        {/if}
        <details class="assume">
          <summary>这次碰到的假设 {out.assumptions.length} 条，另有 {ALWAYS.length} 条每次都适用</summary>
          <ul>
            {#each out.assumptions as x (x.id)}
              {@const a = assumptionOf(x.id)}
              {#if a}
                <li><b>{a.what}</b>（{x.count} 次，影响{IMPACT_NAME[a.impact]}）<br /><span class="muted">{a.why}。{a.adjust ? `怎么改：${a.adjust.how}。` : ''}出处 {a.ref}</span>
                  {#if x.detail.length}<br /><span class="muted">例：{x.detail.join('；')}</span>{/if}</li>
              {/if}
            {/each}
          </ul>
          <p class="muted">每次都适用：</p>
          <ul>{#each ALWAYS as a (a.id)}<li>{a.what}（影响{IMPACT_NAME[a.impact]}）</li>{/each}</ul>
        </details>
      {/if}
    </section>
  {/if}
  <section class="card result" class:full bind:this={result}>
    <div class="views" role="group" aria-label="视图">
      {#if !full}<button type="button" class="ghost" onclick={toggleWide} aria-pressed={wide} title={wide ? '展开左边的编辑器' : '收起编辑器，结果占满宽度'}>{wide ? '› 展开编辑器' : '‹ 收起编辑器'}</button>{/if}
      {#if wide && !full}<select bind:value={name} aria-label="场景">{#each ofKind('scenario') as d (d.name)}<option>{d.name}</option>{/each}</select>{/if}
      {#each VIEWS as v (v.id)}<button type="button" class:on={view === v.id} onclick={() => pick(v.id)} aria-label={v.name}><span class="long">{v.name}</span><span class="short">{v.short}</span></button>{/each}
      {#if (wide || full) && out}<span class="mini">{ran?.name}：{out.label} {fmt(out.steady ?? out.dps)}{stale ? '（有改动未运行）' : ''}</span>{/if}
      {#if wide && !full}<button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '运行中…' : '运行'}</button>{/if}
      {#if out}<button type="button" class="ghost" onclick={() => (full = !full)} aria-pressed={full}>{full ? '退出全屏' : '全屏'}</button>{/if}
    </div>
    {#if out}
      <!-- 高度跟视口走、在框里滚动：B 的吸顶时间轴、D 的整屏布局都要靠它 -->
      <iframe title="时间轴" srcdoc={out.html}></iframe>
    {:else}
      <p class="empty">{busy ? '运行中…' : '选一个场景，点"运行"：结果是时间轴、分轮、分动作与调试表（同 pnpm timeline）。'}</p>
    {/if}
  </section>
</div>

<svelte:window onkeydown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() } else if (e.key === 'Escape' && full) full = false }} />

<style>
  .split { display: grid; grid-template-columns: minmax(320px, 420px) minmax(0, 1fr); gap: 16px; align-items: start; }
  .split.wide { grid-template-columns: minmax(0, 1fr); }
  @media (max-width: 960px) { .split { grid-template-columns: minmax(0, 1fr); } }
  .side { display: grid; gap: 10px; position: sticky; top: 12px; }
  @media (max-width: 960px) { .side { position: static; } }
  .actions { display: flex; align-items: center; gap: 10px; }
  .result { overflow: hidden; min-height: 300px; min-width: 0; }
  .views { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rule); }
  .views button.on { background: var(--ink); color: var(--panel); border-color: var(--ink); }
  .views .ghost { background: transparent; color: var(--muted); }
  .views .mini { margin-left: auto; font-size: 12.5px; color: var(--muted); }
  iframe { width: 100%; border: 0; display: block; background: var(--paper); height: max(560px, calc(100dvh - 150px)); }
  .result.full { position: fixed; inset: 0; z-index: 50; border: 0; border-radius: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .result.full iframe { height: 100%; }
  @media (hover: none) { .kbd { display: none; } }
  .views .short { display: none; }
  @media (max-width: 640px) {
    .views { padding: 8px; }
    .views .long, .views .mini { display: none; }
    .views .short { display: inline; }
  }
  .stats { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 0; }
  .stats dt { font-size: 12px; color: var(--muted); }
  .stats dd { margin: 0; font-family: var(--mono); font-size: 18px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .stale { margin: 0; font-size: 12.5px; color: var(--wait); }
  .warn { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: var(--muted); }
  .alerts { border: 1px solid var(--alert); border-left-width: 4px; border-radius: 6px; padding: 8px 10px; font-size: 12.5px; }
  .alerts b { color: var(--alert); font-weight: 500; }
  .alerts ul { margin: 4px 0 0; padding-left: 18px; }
  details summary { cursor: pointer; font-size: 13px; color: var(--muted); }
  .assume ul { margin: 6px 0; padding-left: 18px; font-size: 13px; display: grid; gap: 6px; }
  .assume li .muted { font-size: 12px; }
</style>

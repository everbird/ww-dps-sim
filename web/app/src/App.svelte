<!-- web/app/src/App.svelte —— 网页（M6）：场景 / 对比 / 边际 / 择优四页，配色沿用 web/timeline.html -->
<script lang="ts">
  import { call } from './api'
  import { ofKind } from './docs.svelte'
  import CompareView from './views/CompareView.svelte'
  import MarginalView from './views/MarginalView.svelte'
  import OptimizeView from './views/OptimizeView.svelte'
  import RunView from './views/RunView.svelte'

  const TABS = [['run', '场景'], ['compare', '对比'], ['marginal', '副词条边际'], ['optimize', '声骸择优']] as const
  let tab = $state<(typeof TABS)[number][0]>('run')
  let name = $state(ofKind('scenario').find(d => d.name === 'm0-team.yaml')?.name ?? ofKind('scenario')[0]?.name ?? '')
  let info = $state('载入数据…')
  call('info', {}).then(i => (info = `数据 ${i.version} · 角色 ${i.characters.join('、')}`), e => (info = (e as Error).message))
</script>

<div class="wrap">
  <header>
    <h1>鸣潮 DPS 仿真</h1>
    <p class="muted">{info}</p>
    <nav>{#each TABS as [k, n]}<button type="button" class:on={tab === k} onclick={() => (tab = k)}>{n}</button>{/each}</nav>
  </header>
  {#if tab === 'run'}<RunView bind:name />{:else if tab === 'compare'}<CompareView {name} />{:else if tab === 'marginal'}<MarginalView bind:name />{:else}<OptimizeView bind:name />{/if}
</div>

<style>
  :global(:root) {
    --paper: #f3f5f8; --panel: #fff; --ink: #1a1f2b; --muted: #5d6576; --faint: #8a91a1; --rule: #d8dce4; --grid: #e8ebf0;
    --alert: #c8323b; --wait: #d9922b; --good: #2f8a5b; --accent: #2a78bb;
    --sans: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) { --paper: #0f1218; --panel: #161a22; --ink: #e5e8ef; --muted: #a2a9b8; --faint: #737b8c; --rule: #2a303c; --grid: #1f242d;
      --alert: #ef5a62; --wait: #e7a443; --good: #4fb47f; --accent: #5aa5e8; color-scheme: dark; }
  }
  :global(body) { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.55 var(--sans); padding: 16px; }
  :global(.card) { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; }
  :global(.pad) { padding: 14px 16px; }
  :global(.row) { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
  :global(.row label) { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; }
  :global(button), :global(select), :global(input) { font: inherit; font-size: 13px; color: var(--ink); background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 3px 10px; }
  :global(button) { cursor: pointer; }
  :global(button.primary) { background: var(--accent); border-color: var(--accent); color: #fff; }
  :global(button:disabled) { opacity: 0.6; cursor: default; }
  :global(.muted) { color: var(--muted); font-size: 13px; margin: 0; }
  :global(.error) { color: var(--alert); white-space: pre-wrap; font-size: 13px; margin: 0; }
  :global(.empty) { color: var(--muted); padding: 30px 16px; margin: 0; }
  :global(h2) { margin: 0 0 8px; font-size: 15px; }
  :global(.tablebox) { overflow-x: auto; }
  :global(table) { border-collapse: collapse; width: 100%; font-size: 13px; }
  :global(th), :global(td) { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
  :global(th) { color: var(--muted); font-weight: 500; font-size: 12px; }
  :global(.r), :global(.num) { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; }
  :global(.up) { color: var(--good); } :global(.down) { color: var(--alert); }
  :global(.stats) { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 0; }
  :global(.stats dt) { font-size: 12px; color: var(--muted); }
  :global(.stats dd) { margin: 0; font-family: var(--mono); font-size: 18px; }
  .wrap { max-width: 1600px; margin: 0 auto; display: grid; gap: 16px; }
  header { display: grid; gap: 6px; }
  h1 { margin: 0; font-size: 22px; }
  nav { display: flex; flex-wrap: wrap; gap: 6px; }
  nav button.on { background: var(--ink); color: var(--panel); border-color: var(--ink); }
</style>

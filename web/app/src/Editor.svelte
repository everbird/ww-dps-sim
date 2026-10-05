<!-- web/app/src/Editor.svelte —— 选一个场景 / 库存，就地编辑 YAML；改动存在本浏览器 -->
<script lang="ts">
  import { copyOf, find, ofKind, persist, remove, type DocKind } from './docs.svelte'

  let { kind, name = $bindable(), rows = 22, label }: { kind: DocKind; name: string; rows?: number; label: string } = $props()
  const doc = $derived(find(kind, name))
  const list = $derived(ofKind(kind))
  const dirty = $derived(doc ? doc.original !== null && doc.text !== doc.original : false)

  function download() {
    if (!doc) return
    const url = URL.createObjectURL(new Blob([doc.text], { type: 'text/yaml' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: doc.name })
    a.click()
    URL.revokeObjectURL(url)
  }
</script>

<div class="editor">
  <div class="bar">
    <label>{label}
      <select bind:value={name}>
        {#each list as d (d.name)}
          <option value={d.name}>{d.name}{d.original === null ? '（副本）' : d.text !== d.original ? '（已改）' : ''}</option>
        {/each}
      </select>
    </label>
    <span class="grow"></span>
    {#if doc}
      <button type="button" onclick={() => (name = copyOf(doc))}>另存副本</button>
      {#if dirty}<button type="button" onclick={() => { doc.text = doc.original!; persist() }}>恢复原文</button>{/if}
      {#if doc.original === null}<button type="button" onclick={() => { const n = list.find(d => d !== doc)?.name; remove(doc); if (n) name = n }}>删除副本</button>{/if}
      <button type="button" onclick={download}>下载</button>
    {/if}
  </div>
  {#if doc}
    <textarea spellcheck="false" {rows} bind:value={doc.text} oninput={persist} aria-label="{label} YAML"></textarea>
    <p class="hint">{doc.original === null ? '网页里另存的副本，只在本浏览器。' : dirty ? '已改动（存在本浏览器，不写回仓库；要留下就下载后放回仓库）。' : `仓库里的 ${kind === 'scenario' ? 'scenarios' : 'inventory'}/${doc.name}`}</p>
  {:else}
    <p class="hint">没有{label}。</p>
  {/if}
</div>

<style>
  .editor { display: grid; gap: 6px; min-width: 0; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .bar label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; }
  .grow { flex: 1; }
  textarea {
    width: 100%; box-sizing: border-box; resize: vertical; font-family: var(--mono); font-size: 12.5px; line-height: 1.55;
    color: var(--ink); background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 8px 10px; tab-size: 2;
    white-space: pre; overflow-wrap: normal; overflow-x: auto;
  }
  .hint { margin: 0; font-size: 12px; color: var(--muted); }
</style>

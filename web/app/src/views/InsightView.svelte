<!-- 结论：同一个场景改一处、多跑几次推出来的结论（同 pnpm insight，TD-10 §6）——共鸣效率需求、操作容错、假设敏感度、指令被挡住的时间 -->
<script lang="ts">
  import { call } from '../api'
  import { find, ofKind } from '../docs.svelte'
  import { fmt, pct, pct2, signed } from '../fmt'
  import type { Requests } from '../protocol'
  import { IMPACT_NAME, assumptionOf } from '../../../../src/engine/assumptions'
  const TIGHT = { better: '反而更好', cascade: '连锁', time: '一轮变长', slack: '有余量' } as const

  let { name = $bindable() }: { name: string } = $props()
  const list = $derived(ofKind('scenario'))
  let busy = $state(false)
  let err = $state<string | null>(null)
  let out = $state<Requests['insight']['res'] | null>(null)
  let secs = $state(0)

  async function run() {
    const d = find('scenario', name)
    if (!d) return
    busy = true; err = null
    const t0 = performance.now()
    try { out = await call('insight', { scenario: { name: d.name, text: d.text } }) } catch (e) { err = (e as Error).message; out = null }
    secs = (performance.now() - t0) / 1000
    busy = false
  }
</script>

<section class="card pad">
  <div class="row">
    <label>场景 <select bind:value={name}>{#each list as d (d.name)}<option>{d.name}</option>{/each}</select></label>
    <button type="button" class="primary" onclick={run} disabled={busy}>{busy ? '计算中…（约 25 次仿真）' : '计算'}</button>
  </div>
  <p class="muted">同一个场景改一处、多跑几次推出的结论，全部按期望值算；比较口径同对比（有分轮取稳态）。</p>
  {#if err}<pre class="error">{err}</pre>{/if}
</section>

{#if out}
  <section class="card pad">
    <h2>口径：{out.basis.label} · DPS {fmt(out.basis.dps)} <span class="muted">（{out.runs} 次仿真，{secs.toFixed(1)} 秒）</span></h2>

    <h3>共鸣效率需求</h3>
    <p class="muted">轴里的大招不等能量，每人最低要多少共鸣效率（按单调二分，精确到 0.25%）。富余的部分可以换成别的副词条。标"下限"的是面板 100% 加常驻 buff，压不下去了：不堆共鸣效率也够。</p>
    <div class="tablebox"><table>
      <thead><tr><th>角色</th><th class="r">现在</th><th class="r">最低</th><th class="r">富余</th><th class="r">现在等能量</th></tr></thead>
      <tbody>
        {#each out.energy as e (e.char)}
          {@const atFloor = e.need !== null && e.need <= e.floor + 1e-9}
          <tr>
            <td>{e.char}</td><td class="r">{pct(e.current)}</td>
            <td class="r">{e.need === null ? `> ${pct(e.current + 2)}` : pct(e.need)}{#if atFloor}<span class="muted">（下限）</span>{/if}</td>
            <td class="r" class:up={e.need !== null && e.current > e.need} class:down={e.need === null || e.current < e.need}>{e.need === null ? '—' : signed(e.current - e.need, pct)}</td>
            <td class="r">{e.waitSecs > 0 ? `${e.waitSecs.toFixed(2)} 秒` : '—'}</td>
          </tr>
        {:else}
          <tr><td colspan="5" class="muted">轴里没有大招</td></tr>
        {/each}
      </tbody>
    </table></div>

    <h3>操作容错</h3>
    <p class="muted">切人与不是连段后续的出招，在合法之后都再晚 N 帧（人的反应时间；连段后续按预输入不加）。0 = 最早合法帧，是理论上限。</p>
    <div class="tablebox"><table>
      <thead><tr><th class="r">晚几帧</th><th class="r">DPS</th><th class="r">变化</th><th class="r">每轮</th></tr></thead>
      <tbody>
        {#each out.tolerance as t (t.delay)}
          <tr>
            <td class="r">{t.delay}</td>
            {#if t.error}<td colspan="3" class="error">跑不通：{t.error}</td>
            {:else}<td class="r">{fmt(t.dps!)}</td><td class="r" class:down={t.change! < -0.0005}>{signed(t.change!, pct2)}</td><td class="r">{t.loopSecs!.toFixed(2)} 秒</td>{/if}
          </tr>
        {/each}
      </tbody>
    </table></div>

    <h3>假设敏感度</h3>
    <p class="muted">假设表里能自动翻的开关逐个翻一下（总设计 T16；全部假设见场景页的"假设"或 pnpm assumptions）。</p>
    <div class="tablebox"><table>
      <thead><tr><th>假设</th><th>改成</th><th class="r">DPS 变化</th><th>估计影响</th></tr></thead>
      <tbody>
        {#each out.sensitivity as s (s.change)}
          {@const a = assumptionOf(s.id)}
          <tr>
            <td class="wrap">{s.what}</td><td><code>{s.change}</code></td>
            {#if s.error}<td class="error">跑不通：{s.error}</td>{:else}<td class="r" class:down={s.pct! < -0.0005} class:up={s.pct! > 0.0005}>{signed(s.pct!, pct2)}</td>{/if}
            <td>{a ? IMPACT_NAME[a.impact] : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table></div>
    {#if out.notHit.length}<p class="muted">这次没碰到、翻了也一样（不跑）：{out.notHit.join('、')}</p>{/if}

    <h3>指令被挡住的时间</h3>
    <p class="muted">窗口里队首指令在等什么（前一招可能还在打，不等于空闲）；写轴要求的、操作延迟、正常出招节奏（派生窗口、优先级）不算。</p>
    <div class="tablebox"><table>
      <thead><tr><th>原因</th><th class="r">合计</th><th class="r">占窗口</th><th>最长的几段</th></tr></thead>
      <tbody>
        {#each out.waits as w (w.code)}
          <tr>
            <td>{w.label}</td><td class="r">{w.secs.toFixed(2)} 秒</td><td class="r">{pct(w.share)}</td>
            <td class="wrap">{#each w.top as t}<div>{t.where}：{t.secs.toFixed(2)} 秒，{t.reason}</div>{/each}</td>
          </tr>
        {:else}
          <tr><td colspan="4" class="muted">没有</td></tr>
        {/each}
      </tbody>
    </table></div>

    <h3>卡帧点</h3>
    <p class="muted">
      循环轴的每个决策点单独每轮晚 {out.tightFrames} 帧（其余照常），影响拆成"每轮多几帧"与"每轮伤害变多少"。
      连锁：一轮多出的比晚的还多，或每轮伤害少了——真要卡帧的地方，先实测能不能预输入；一轮变长：晚几帧多几帧，按手速线性地掉；
      有余量：单独晚这一处无所谓（几处共用余量，处处都晚时仍会掉，见操作容错）；反而更好：原轴这里按早了。
    </p>
    <div class="tablebox"><table>
      <thead><tr><th>类别</th><th>指令</th><th class="r">DPS</th><th class="r">每轮</th><th class="r">每轮伤害</th></tr></thead>
      <tbody>
        {#each out.tight.filter(t => t.kind !== 'slack') as t (`${t.line}.${t.item}`)}
          <tr>
            <td>{t.kind ? TIGHT[t.kind] : '跑不通'}</td>
            <td>第 {t.line} 条第 {t.item} 个 {t.what}</td>
            {#if t.error}<td colspan="3" class="muted">{t.error}</td>
            {:else}
              <td class="r" class:up={t.pct! > 1e-6} class:down={t.pct! < -1e-6}>{signed(t.pct!, pct2)}</td>
              <td class="r">{t.extraFrames! >= 0 ? '+' : ''}{t.extraFrames!.toFixed(0)} 帧</td>
              <td class="r">{signed(t.dmgPct!, pct2)}</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table></div>
    {#if out.tight.some(t => t.kind === 'slack')}<p class="muted">有余量（{out.tight.filter(t => t.kind === 'slack').length} 处）：{out.tight.filter(t => t.kind === 'slack').map(t => t.what).join('、')}</p>{/if}
  </section>
{/if}

<style>
  h3 { margin: 18px 0 4px; font-size: 14px; }
  td.wrap { white-space: normal; min-width: 180px; }
  code { font-family: var(--mono); font-size: 12px; }
</style>

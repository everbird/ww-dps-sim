<!-- 时间轴对照（对比页，原型 2026-10-21）：两份场景按战斗秒对齐。每人两条（上基准、下对比），轴里改过的那几条描边；
     浅底是各自的比较口径（稳态）窗口，竖线是每轮开始；下面是累计伤害差（对比 − 基准），看是在哪一段拉开的 -->
<script lang="ts">
  import type { DiffTimeline, LaneAction } from '../../../../src/report/diff-timeline'
  import { fmt, signed } from '../fmt'

  let { tl, team }: { tl: DiffTimeline; team: string[] } = $props()
  const PX = 10, LEFT = 70, TOP = 6, ROW = 11, GAP = 3, PAIR = ROW * 2 + GAP + 12, CH = 90
  const COLORS = ['#3d84c6', '#b5579e', '#3f9a6a']
  const end = $derived(Math.max(tl.base.end, tl.other.end))
  const W = $derived(LEFT + end * PX + 20)
  const lanesH = $derived(TOP + team.length * PAIR)
  const H = $derived(lanesH + CH + 34)
  const x = (t: number) => LEFT + t * PX
  const color = (c: string) => COLORS[team.indexOf(c) % COLORS.length] ?? '#888'
  const ticks = $derived(Array.from({ length: Math.floor(end / 10) + 1 }, (_, i) => i * 10))
  const maxAbs = $derived(Math.max(1, ...tl.diff.map(d => Math.abs(d[1]))))
  const y0 = $derived(lanesH + 14 + CH / 2)
  const yd = (v: number) => y0 - (v / maxAbs) * (CH / 2 - 4)
  const path = $derived(tl.diff.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${yd(v).toFixed(1)}`).join(''))
  const last = $derived(tl.diff.at(-1)?.[1] ?? 0)
  const tip = (a: LaneAction) => `${a.char} ${a.action}：${a.t0.toFixed(2)}–${a.t1.toFixed(2)} 秒${a.changed ? '（轴里改过的那一条）' : ''}`
  const changedCount = $derived(tl.other.actions.filter(a => a.changed).length)
</script>

<section class="card pad">
  <h2>时间轴对照 <span class="muted">（原型）</span></h2>
  <p class="muted">
    按战斗秒对齐；每人上一条是基准、下一条是对比，描边的是循环轴里两份不同的那几条（对比里 {changedCount} 个动作）；浅底是比较口径的窗口，竖线是每轮开始。
    下面的曲线是累计伤害差（对比 − 基准）：到窗口末尾 {signed(last)}。
  </p>
  <div class="tablebox">
    <svg width={W} height={H} role="img" aria-label="两条轴的时间轴对照">
      {#each ticks as t}
        <line x1={x(t)} x2={x(t)} y1="0" y2={H - 16} class="grid" />
        <text x={x(t)} y={H - 4} class="tick" text-anchor="middle">{t}s</text>
      {/each}
      {#each team as c, i}
        {#each [['基准', tl.base], ['对比', tl.other]] as const as [label, lanes], k}
          {@const y = TOP + i * PAIR + k * (ROW + GAP)}
          <rect x={x(lanes.steady[0])} y={y} width={(lanes.steady[1] - lanes.steady[0]) * PX} height={ROW} class="steady" />
          {#each lanes.loops as l}<line x1={x(l.t)} x2={x(l.t)} y1={y - 1} y2={y + ROW + 1} class="loop" />{/each}
          {#each lanes.actions.filter(a => a.char === c) as a}
            <rect x={x(a.t0)} y={y + 1} width={Math.max(1, (a.t1 - a.t0) * PX)} height={ROW - 2} fill={color(c)} class:changed={a.changed}><title>{tip(a)}</title></rect>
          {/each}
          <text x={LEFT - 6} y={y + ROW - 2} class="label" text-anchor="end">{k === 0 ? c : ''} {label}</text>
        {/each}
      {/each}
      <line x1={LEFT} x2={x(end)} y1={y0} y2={y0} class="zero" />
      <path d={path} class="diff" class:up={last > 0} class:down={last < 0} />
      <text x={LEFT - 6} y={y0 - CH / 2 + 10} class="label" text-anchor="end">+{fmt(maxAbs)}</text>
      <text x={LEFT - 6} y={y0 + 4} class="label" text-anchor="end">0</text>
      <text x={LEFT - 6} y={y0 + CH / 2} class="label" text-anchor="end">−{fmt(maxAbs)}</text>
    </svg>
  </div>
</section>

<style>
  svg { display: block; font-family: var(--mono); }
  .grid { stroke: var(--grid); }
  .tick, .label { fill: var(--muted); font-size: 10px; }
  .steady { fill: var(--grid); }
  .loop { stroke: var(--faint); stroke-dasharray: 2 2; }
  rect.changed { stroke: var(--ink); stroke-width: 1.5; }
  .zero { stroke: var(--faint); }
  .diff { fill: none; stroke: var(--muted); stroke-width: 1.5; }
  .diff.up { stroke: var(--good); } .diff.down { stroke: var(--alert); }
</style>

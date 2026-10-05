# 鸣潮 DPS 引擎 · TD-12 网页界面 v0.1

> **状态**：v0.1（2026-10-05），随实现写成（`web/app/`，用例 `tests/web.test.ts`）。技术栈按总设计第 10 节的倾向定为 Vite + Svelte 5（2026-10-05 用户确认）。
> **依据**：《技术总体设计 v0.1.9》第 9、10 节与第 12 节 M6（"浏览器里能完成 M5 的全部操作"）；《TD-10 输出与报告 v0.1.3》（汇总、对比、边际、时间轴网页）；《TD-11 调试与校准手册 v0.1》（调试表）；《TD-13 声骸库存择优 v0.1》
> **不讲**：时间轴网页本身（`web/timeline.html`，TD-10 §5.1）

---

## 0. 要点

1. **只在本机用**：生成数据（`data/generated`）不进 git、不发布，网页直接读仓库里的文件。`pnpm web` 起开发服务器（`http://localhost:5317/`）；`pnpm web:build` 打包到 `out/web/`（含数据，不要发布）。
2. **四页**：场景（编辑、运行，看时间轴页面）、对比、副词条边际、声骸择优；结果与 `pnpm sim` / `timeline` / `compare` / `marginal` / `optimize` 相同（同一套引擎与分析函数）。
3. **引擎在 Web Worker 里跑**：择优要十几秒，页面不卡。
4. **改动存在浏览器**：场景与库存的编辑存在 localStorage，不写回仓库；要留下就"下载"后放回 `scenarios/`、`inventory/`。

---

## 1. 结构

| 文件 | 内容 |
|---|---|
| `web/app/vite.config.ts` | root 是 `web/app`；`server.fs.allow` 放开仓库根目录（读 `data/`、`scenarios/`、`inventory/`） |
| `src/gamedata.ts` | 浏览器侧装配 `GameData`：同 `src/data/load.ts`，文件由 `import.meta.glob` 读（动作文件只读用得到的块），交给同一个 `buildGameData` |
| `src/handlers.ts` | Worker 的各请求：`info`、`run`（仿真 + 时间轴页面 HTML）、`compare`、`marginal`、`optimize`；场景 / 库存的 YAML 用同一套 zod schema 校验，报错带文件名与位置 |
| `src/worker.ts`、`src/api.ts`、`src/protocol.ts` | 消息收发（按 id 配对）与请求 / 回复的类型 |
| `src/docs.svelte.ts`、`src/Editor.svelte` | 可编辑的 YAML：仓库里的场景与库存（构建时读入）、网页里另存的副本；改过的与副本存 localStorage |
| `src/views/*.svelte` | 四页 |

时间轴页面的数据模型移到 `src/report/timeline.ts`（纯函数），CLI 与网页共用；"场景"页把它嵌进 iframe（`srcdoc`），高度跟着内容。

## 2. 各页

| 页 | 操作 | 显示 |
|---|---|---|
| 场景 | 选场景、编辑、运行（Ctrl+Enter）；另存副本、恢复原文、下载 | 稳态 / 整个窗口 DPS、提示、运行报错；时间轴页面（含分轮、分动作、等待、调试表与视频对照） |
| 对比 | 选基准与对比（可以是副本） | 两边 DPS 与差；面板变化；分角色、分动作、buff 覆盖率的差（TD-10 §3） |
| 副词条边际 | 选场景、角色、一档取法 | 各副词条 +1 档的 DPS 与增量，带条形（TD-10 §4） |
| 声骸择优 | 选场景、角色、库存（可编辑）、列出几套、预筛留几件、5 件套、是否拿队友的 | 现在的 DPS、约束、规模与耗时；每套的 DPS、差、估计、面板与 5 件；第 1 套的 echoes 写法（可复制）（TD-13） |

配色、字体沿用 `web/timeline.html` 的 token，跟随系统深浅色。

## 3. 检查

- `pnpm check` 同时跑 `svelte-check`（`web/app/tsconfig.json`）。
- `tests/web.test.ts`：浏览器侧装配的 GameData 与 Node 侧相同；`run`、`compare`、`optimize` 跑通、数值与命令行一致；场景写错时报出文件名。界面本身没有自动化测试（本机没有浏览器），改界面后手动打开看一遍。

## 4. 待定问题

| # | 问题 | 现在的做法 |
|---|---|---|
| Q1 | 改动写回仓库 | 不写；下载后自己放回。需要时给开发服务器加一个只写 `scenarios/`、`inventory/` 的接口 |
| Q2 | 排轴的可视化编辑（拖动动作条） | 还是文本编辑；时间轴只读 |
| Q3 | 择优的进度 | 只有"搜索中"；需要时由 Worker 分阶段回报 |

## 附录：变更历史

- **v0.1（2026-10-05）**：初版，随实现写成。

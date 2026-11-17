# `tools/build`（Python）与 TypeScript Schema 的同步评估与改进建议

## 1. 现状评估：到底有没有冗余？

结论：**没有把引擎的整套 TS Schema 在 Python 里重实现一遍，但存在“中间 JSON 交换契约”的双端同步成本。**

### 1.1 没有冗余的部分（分工边界清晰）
- **运行期与输入 Schema 只在 TypeScript 侧**：`SimState`、`Scenario`、`BuffDef`、`ActionDef`、`Calibration`、`Evidence` 等全部定义在 `src/data/*.schema.ts` 与 `src/engine/`，Python 完全不涉及。
- **构建产物的校验职责单一**：`tools/build/build_data.py` 只负责将 `.xlsx` 与 nanoka 数据抽取为 `data/generated/*.json`，脚本自身并不维护 Pydantic / dataclass 校验层；所有产物合法性统一由 `src/data/check-generated.ts` 使用 `src/data/generated.schema.ts`（Zod `strictObject`）负责校验。

### 1.2 实际存在的双写点（跨语言 JSON 契约）
Python 组装输出 `dict` 与 TypeScript 的 `generated.schema.ts` 之间，存在两类需要人工保持同步的信息：
1. **字段名与嵌套结构**：例如 `GenRowSchema`、`HintsSchema` 中的 `birthFrame`、`delayFrames`、`whiteBarRatio`、`noSwitchWhileInvincible`、`endOnSwitchAfter`、`reuses` 等键名，在 `tools/build/actions.py`、`parse.py`、`dmg.py` 等文件里按字符串硬拼，同时在 `src/data/generated.schema.ts` 中逐字段声明。
2. **跨语言共享枚举与映射表**：
   - **元素列表**：`tools/build/characters.py`（`ELEMENTS`）、`tools/build/echo_stats.py`（`_ELEMENTS`）与 `src/data/common.ts`（`ELEMENTS` / `ELEMENT_BY_CODE`）各自维护；
   - **膨胀类型**：`tools/build/actions.py`（`DILATION_TYPES`）与 `src/data/common.ts`（`DILATION_TYPES`）各自维护；
   - **武器列表**：`tools/build/tune_break.py`（`WEAPONS`）与 `src/data/common.ts`（`WEAPON_TYPES`）各自维护。

---

## 2. 为什么目前不建议重写为纯 TypeScript？

鸣潮基础数据表（`data/raw/*.xlsx`）包含大量多行合并单元格、公式原式与缓存值并存的单元格（`build_data.py` 同时以 `data_only=True` 与 `data_only=False` 读取）以及基于表格公式的数值解析与校验（`xlformula.py`、`golden.py`、`golden_perturb.py`）。

`tools/build/` 属于低频离线构建脚本，Python + `openpyxl` 在处理这类复杂 Excel 表格时成熟稳定，且仓库已经配套了十余个 `tools/build/test_*.py` 单元测试与 `golden` 扰动对拍。按“实用、清晰、简单”的原则，**不建议为了消除双语言而重写这批已经稳定的抽取脚本**。

---

## 3. 实用改进建议（按投入产出比排序）

### 建议一：构建后自动串联 `pnpm check:data`（零成本防漂移）
- **做法**：在 `package.json` 中提供一步到位的构建校验命令（或让 `build_data.py` 在检测到 Node 环境时可选自动执行 `pnpm check:data`）。
- **收益**：只要 Python 侧增删改了任意输出字段或写错枚举值，Zod `strictObject` 会当场拦住，避免脏结构流入引擎或等到手工跑检查才发现。

### 建议二：把共享枚举/代码表抽为单一 JSON 源（消除字典双写）
- **做法**：将 `ELEMENTS`、`ELEMENT_BY_CODE`、`DILATION_TYPES`、`WEAPON_TYPES`、`BODY_TYPES`、`ECHO_BODIES` 等两端共用的常量表抽成一份纯 JSON（如 `src/data/common-constants.json` 或 `data/curated/constants.json`）：
  - **TS 侧**：`src/data/common.ts` 直接导入并推导 `as const` 字面量类型与 `z.enum(...)`；
  - **Python 侧**：`tools/build/` 启动时直接 `json.loads(...)` 读取，移除 `.py` 中重复硬编码的列表与映射字典。
- **收益**：后续游戏版本新增元素、武器或膨胀类型时只需改一处，两端自动一致。

### 建议三：利用 Zod v4 自带的 JSON Schema 导出做契约校验（按需采用）
- **现状基础**：项目 `package.json` 当前使用的是 `zod@^4.0.0`，原生提供 `z.toJSONSchema()`，无需引入额外重型依赖。
- **做法**：若后续 `data/generated/*.json` 的数据结构变动频繁，可用一小段 TS 脚本从 `src/data/generated.schema.ts` 导出 JSON Schema 供 `tools/build/test_*.py` 在单测中校验抽取结果样本（或直接与 `pnpm check:data` 联动）。
- **收益**：确立 TypeScript Zod Schema 为唯一真理来源（Single Source of Truth），Python 侧无需额外维护一份平行 Schema 文档。

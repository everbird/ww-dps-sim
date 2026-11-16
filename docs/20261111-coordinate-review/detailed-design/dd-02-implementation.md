# DD-02 实现记录（2026-11-16）

依据 DD-02 v0.3 §3，实现严格声明、CLI 覆盖、源码与装配检查、意图失败与诊断续跑、严格报告、超时上下文、多余强制提示、notation 与谐破口径。sim / insight / sensitivity 经 prepareRun 处理严格覆盖。T02-8（`!@N`）按 DD02-Q3 延后；candidates 属于尚未实施的 DD-04。

## 兼容性核对

用 HEAD 的独立临时副本，只把变奏等待改成 concertoSettle，生成 T02-2 基线；与本次 conformance 的 29 个场景逐键序列化比较：log、summary、error、completion、interventions 全部相同。整个输出文件不可能逐字节一致：本包有意增加 strictReport 内容、options.strict 身份字段和 tys-video 的 damageScope 原因。

场景快照只有以下 wait-settled 次数变化，所有伤害、帧数与其他快照字段未变：

| 场景 | 原次数 | 现在 |
|---|---:|---:|
| alm-爱琳莫 | 62 | 55 |
| fire-tower1-video | 15 | 12 |
| fire-tower2-video | 14 | 13 |
| jys-5r18z | 67 | 64 |
| jys-5r18z-尤诺快开大 | 59 | 56 |
| jys-5r20z | 84 | 81 |
| tys-video | 25 | 21 |
| xin-team | 66 | 61 |

## 用例与命令行

`tests/strict-teaching.test.ts` 使用合成角色，不依赖生成数据。覆盖六类核心夹具、编译问题、CLI 覆盖来源、诊断续跑、超时角色归属、谐破口径、notation 摘要排除、变奏钩子回退与错误 ID；另检查续跑后再次意图失败时报告不丢终止意图。`tests/td09.test.ts` 明确断言变奏等待使用 concertoSettle。

`pnpm sim scenarios/m0-video-eq.yaml --strict` 返回编译问题 strict.tuneBreakAuto，退出码 1，符合验收要求。

## 验证说明

`pnpm conformance` 完成 29 个场景；`pnpm fuzz` 完成 29 个场景，问题 0 条。上述兼容性对拍比较的是业务日志与结果，不包含本包新增的报告、身份和口径字段，因此不把原验收清单中的“整个输出逐字节相同”标成通过。

录像变体排序测试需要多次完整仿真，本机复跑超过默认 5 秒；将该项测试上限设为 30 秒，所有断言保留。

最终执行 `pnpm check && pnpm test && pnpm test:py` 全部通过：TypeScript / Svelte 检查无错误与警告；Vitest 58 个文件、694 项通过、37 项既有待办；Python 71 项通过。严格教学入口合成用例 20 项全部通过。

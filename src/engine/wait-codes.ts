// DD-10 §4⑤：等待分类同时供执行与汇总使用，不依赖调度器。
import type { WaitCode } from './types'

/** 写轴的人要求的等待与操作延迟：不计入 maxWait，汇总的 waits 也不列。 */
export const INTENDED: readonly WaitCode[] = ['delay', 'wait', 'at', 'input']
export const INTENT_WAITS = ['concertoSettle', 'airborne', 'entryBusy'] as const

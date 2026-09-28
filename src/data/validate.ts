// src/data/validate.ts —— 边界校验的统一入口（TD-02 §0.3）
import { z } from 'zod'

z.config(z.locales.zhCN())   // zod 自带中文报错；自定义规则的报错本来就是中文

/** 校验并返回补齐默认值后的数据；失败时抛出带位置的错误（CLI 直接打印，网页显示在编辑器旁） */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown, where: string): z.output<S> {
  const r = schema.safeParse(data)
  if (r.success) return r.data
  throw new Error(`${where} 校验失败：\n${z.prettifyError(r.error)}`)
}

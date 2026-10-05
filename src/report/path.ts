// src/report/path.ts —— 不依赖 node:path 的文件名小工具（网页里也能用）
export const basename = (p: string, ext = ''): string => {
  const b = p.replace(/^.*[\\/]/, '')
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b
}
export const extname = (p: string): string => {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i) : ''
}

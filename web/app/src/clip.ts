// web/app/src/clip.ts —— 复制到剪贴板。用 http 加域名访问（不是安全来源）时浏览器不给 navigator.clipboard，
// 退回 execCommand('copy')（iPhone 上要临时去掉 readonly 才选得中）；都不行返回 false，页面提示手动复制
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* 往下退回旧办法 */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0; font-size: 16px'
  document.body.appendChild(ta)
  ta.removeAttribute('readonly')
  ta.select()
  ta.setSelectionRange(0, text.length)
  ta.setAttribute('readonly', '')
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}

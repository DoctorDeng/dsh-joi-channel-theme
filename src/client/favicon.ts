/**
 * 🍊 favicon —— 元素表里橘子的第一个职责位。
 *
 * 橘子是主播的印象 emoji，两套衣装都用它；把它放到标签页图标上，
 * 主题在窗口切换器里也认得出来。SVG data URI，无外链（CSP 不放行）。
 */

/** 内联 SVG。26px 的字号在 32 画布里刚好占满而不裁切。 */
const HREF = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
  + '<text x="16" y="25" font-size="26" text-anchor="middle">🍊</text></svg>',
)}`

/** 一条 icon link 的原样，供还原。存属性字符串而不是 IDL 值，还原时逐字节回去。 */
interface OriginalLink {
  /** 被改的那条 link。 */
  link: HTMLLinkElement
  /** 原来的 rel 属性。 */
  rel: string | null
  /** 原来的 type 属性。 */
  type: string | null
  /** 原来的 href 属性。 */
  href: string | null
}

/**
 * 换上橘子 favicon，并在卸载时还原原图标。
 *
 * 必须改**每一条** icon link，不能只改第一条 —— 0.1.7-rc.1 的 index.html 里有
 * 两条，各带一条 media，浏览器按 media 选一条用：
 *
 *   <link rel="icon" … href="./favicon-dark.svg" media="(prefers-color-scheme: dark)">
 *   <link rel="icon" … href="./favicon.svg"      media="(prefers-color-scheme: light)">
 *
 * 旧版只有一条，所以 querySelector 取第一条一直是对的；0.1.7 起那样改中的是
 * **dark 那条**，浅色模式下浏览器用的仍是第二条原生 logo（dark 模式下才会
 * 歪打正着看到橘子）。两条都指向橘子即可，media 各自保留不动。
 * @returns 还原 disposer。
 */
export function installFavicon(): () => void {
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
  if (links.length === 0) {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    link.href = HREF
    document.head.append(link)
    return () => { link.remove() }
  }
  const before: OriginalLink[] = links.map(link => ({
    link,
    rel: link.getAttribute('rel'),
    type: link.getAttribute('type'),
    href: link.getAttribute('href'),
  }))
  for (const link of links) {
    link.setAttribute('rel', 'icon')
    link.setAttribute('type', 'image/svg+xml')
    link.setAttribute('href', HREF)
  }
  return () => {
    for (const { link, rel, type, href } of before) {
      if (rel === null) link.removeAttribute('rel')
      else link.setAttribute('rel', rel)
      if (type === null) link.removeAttribute('type')
      else link.setAttribute('type', type)
      if (href === null) link.removeAttribute('href')
      else link.setAttribute('href', href)
    }
  }
}

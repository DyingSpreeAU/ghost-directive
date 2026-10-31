// Easter eggs. Every one is listed in EASTER_EGGS.md with its trigger; add new ones there too.
import { useEffect } from 'react'

/** Zorpalod: a Guardian named "Zorpalod" sees this owl in place of every image, on their own device. */
export const ZORPALOD_IMG = '/easter/zorpalod.webp'
export const isZorpalod = (name: string | undefined) => name?.trim().toLowerCase() === 'zorpalod'

/**
 * While on, every <img> on the page shows the owl (the real address is kept in data-zorpalod to put
 * back), including ones React adds or changes later, and CSS background images (emblems) follow
 * through the `zorpalod` class on <html>.
 */
export function useZorpalod(on: boolean) {
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    root.classList.add('zorpalod')
    const swap = (img: HTMLImageElement) => {
      const src = img.getAttribute('src')
      if (!src || src === ZORPALOD_IMG) return
      img.dataset.zorpalod = src
      img.setAttribute('src', ZORPALOD_IMG)
      img.removeAttribute('srcset')
    }
    const sweep = (n: ParentNode) => n.querySelectorAll('img').forEach(swap)
    sweep(document)
    const mo = new MutationObserver((changes) => {
      for (const c of changes) {
        if (c.type === 'attributes' && c.target instanceof HTMLImageElement) swap(c.target)
        c.addedNodes.forEach((n) => { if (n instanceof HTMLImageElement) swap(n); else if (n instanceof Element) sweep(n) })
      }
    })
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
    return () => {
      mo.disconnect()
      root.classList.remove('zorpalod')
      document.querySelectorAll<HTMLImageElement>('img[data-zorpalod]').forEach((img) => {
        img.setAttribute('src', img.dataset.zorpalod!)
        delete img.dataset.zorpalod
      })
    }
  }, [on])
}

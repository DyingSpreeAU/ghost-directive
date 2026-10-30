// Every `title` hover in the app, shown at once in the app's own style instead of the browser's
// delayed plain tooltip. One listener for the whole page: while an element is hovered or focused its
// title is lifted off (so the browser's own tooltip never shows) and put back when it's left.

import { useEffect, useRef, useState } from 'react'

type Tip = { text: string; x: number; y: number; below: boolean }

/** Lifts an element's title off while its tip shows; returns the text and how to put it back. */
function lift(el: Element) {
  const title = el.getAttribute('title')
  if (!title) return null
  el.removeAttribute('title')
  return { text: title, restore: () => { if (!el.hasAttribute('title')) el.setAttribute('title', title) } }
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const current = useRef<{ el: Element; restore: () => void } | null>(null)
  const bubble = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const show = (target: EventTarget | null) => {
      const el = target instanceof Element ? target.closest('[title]') : null
      // Still inside the element whose tip is showing (its title is lifted, so closest() skips it).
      if (current.current && target instanceof Node && current.current.el.contains(target) && (!el || current.current.el.contains(el) === false)) return
      if (current.current && el === current.current.el) return
      current.current?.restore()
      const lifted = el ? lift(el) : null
      current.current = el && lifted ? { el, restore: lifted.restore } : null
      if (!el || !lifted) { setTip(null); return }
      const text = lifted.text
      const r = el.getBoundingClientRect()
      const below = r.top < 64
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below })
    }
    const over = (e: MouseEvent) => show(e.target)
    const focus = (e: FocusEvent) => { if ((e.target as Element)?.matches?.(':focus-visible')) show(e.target) }
    const hide = () => { current.current?.restore(); current.current = null; setTip(null) }
    document.addEventListener('mouseover', over)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', hide)
    document.addEventListener('scroll', hide, true)
    // A click hides the bubble but keeps the title lifted until the pointer leaves, so the browser's doesn't appear.
    const press = () => setTip(null)
    document.addEventListener('mousedown', press)
    window.addEventListener('blur', hide)
    // The bubble is placed for the current layout: a resize (or phone rotation) drops it.
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('mousedown', press)
      window.removeEventListener('blur', hide)
      window.removeEventListener('resize', hide)
    }
  }, [])

  // Keep the bubble inside the window.
  const [shift, setShift] = useState(0)
  useEffect(() => {
    const b = bubble.current
    if (!b || !tip) return
    const r = b.getBoundingClientRect()
    setShift(r.left < 8 ? 8 - r.left : r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0)
  }, [tip])

  if (!tip) return null
  return (
    <div ref={bubble} className={`ui-tip ${tip.below ? 'is-below' : ''}`} role="tooltip"
      style={{ left: tip.x + shift, top: tip.y, ['--arrow-shift' as string]: `${-shift}px` }}>
      {tip.text}
    </div>
  )
}

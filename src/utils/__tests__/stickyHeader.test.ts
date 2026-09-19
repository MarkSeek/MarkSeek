import { describe, expect, it } from 'vitest'
import { isPinned, type StickyMetrics } from '../stickyHeader'

/** Build metrics directly: the DOM measurement needs real layout, the rule does not. */
function metrics(naturalTop: number, visualTop: number, stickyTop: number): StickyMetrics {
  return { naturalTop, visualTop, stickyTop }
}

describe('isPinned', () => {
  it('is true for a header held at its sticky offset after scrolling', () => {
    // naturalTop 200, scrolled so it is painted exactly at stickyTop 32.
    expect(isPinned(metrics(200, 32, 32), 168)).toBe(true)
  })

  it('is false when the container has not scrolled', () => {
    // A top-level header merely sitting at the container top is not pinned.
    expect(isPinned(metrics(0, 0, 0), 0)).toBe(false)
  })

  it('is false when the header is painted away from its sticky offset', () => {
    // Still at its natural position, nowhere near the sticky threshold.
    expect(isPinned(metrics(120, 88, 32), 32)).toBe(false)
  })

  it('is false when the header naturally sits AT the sticky offset', () => {
    // Not pushed up by scrolling — it was always there.
    expect(isPinned(metrics(32, 32, 32), 0)).toBe(false)
  })

  it('tolerates sub-pixel rounding', () => {
    expect(isPinned(metrics(200, 32.4, 32), 168)).toBe(true)
    expect(isPinned(metrics(200, 32.6, 32), 168)).toBe(false)
  })

  it('is false for a nested header whose natural position is above the threshold', () => {
    // ScrollTop is large but this header belongs to a group already scrolled past.
    expect(isPinned(metrics(10, 64, 64), 500)).toBe(false)
  })
})

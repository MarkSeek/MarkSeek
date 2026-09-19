import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon } from '../Icon'

describe('Icon', () => {
  it('renders an inline svg for a registered name', () => {
    const { container } = render(<Icon name="file" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
  })

  it('honours an explicit size', () => {
    const { container } = render(<Icon name="folder" size={32} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('32')
    expect(svg?.getAttribute('height')).toBe('32')
  })

  it('fills the shape when `filled` is set', () => {
    const { container } = render(<Icon name="star" filled />)
    expect(container.querySelector('svg')?.getAttribute('fill')).toBe('currentColor')
  })

  it('renders nothing for an unknown name', () => {
    const { container } = render(<Icon name={'nope' as never} />)
    expect(container.innerHTML).toBe('')
  })
})

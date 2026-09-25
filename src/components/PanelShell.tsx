import type { MouseEvent, ReactNode } from 'react'
import { Icon, type IconName } from './icons/Icon'
import { t } from '../i18n'

// Re-exported so views can build row actions without a second import.
export type { IconName }

/**
 * Shared, purely presentational building blocks for the right-panel views
 * (conversation history / note relations). Every primitive is driven by the
 * warm theme CSS variables so both views end up with one visual language:
 * same header, same rows, same groups, same empty and loading states.
 */

/** A hover-revealed icon action attached to a row. */
export interface PanelRowAction {
  icon: IconName
  title: string
  onClick: () => void
  danger?: boolean
}

/** Root wrapper of a right-panel sub-view. */
export function PanelView({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`rpp-view${className ? ` ${className}` : ''}`}>{children}</div>
}

/**
 * Secondary header shared by every sub-view:
 * circular back button + title + count badge on the left, ghost actions right.
 */
export function ViewHeader({
  onBack,
  backTitle,
  backIcon = 'arrow-left',
  title,
  count,
  actions,
}: {
  onBack?: () => void
  backTitle?: string
  /** Override the leading glyph (e.g. `close` for overlay panels). */
  backIcon?: IconName
  title: string
  count?: number
  actions?: ReactNode
}) {
  return (
    <div className="rpp-header">
      {onBack && (
        <button
          type="button"
          className="rpp-icon-btn"
          title={backTitle ?? t('chat.back')}
          onClick={onBack}
        >
          <Icon name={backIcon} size={14} />
        </button>
      )}
      <span className="rpp-header-title" title={title}>
        {title}
      </span>
      {count !== undefined && <span className="rpp-badge">{count}</span>}
      {actions && <div className="rpp-header-actions">{actions}</div>}
    </div>
  )
}

/** Compact search field used by scrollable list views. */
export function PanelSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div className="rpp-search-wrap">
      <div className="rpp-search">
        <Icon name="search" size={13} className="rpp-search-icon" />
        <input
          className="rpp-search-input"
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

/** Scrollable content area with a consistent bottom safe margin. */
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="rpp-body">{children}</div>
}

/**
 * Titled block (history date group or relations section) with count + hint.
 * `collapsible` turns the head into a disclosure button; the head stays
 * visible either way, only the body is toggled.
 */
export function PanelSection({
  title,
  count,
  hint,
  icon,
  children,
  collapsible,
  open = true,
  onToggle,
}: {
  title: string
  count?: number
  hint?: string
  /** Leading glyph shown instead of the default accent bar. */
  icon?: ReactNode
  children: ReactNode
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const head = (
    <div className="rpp-section-head">
      {collapsible && (
        <span className="rpp-section-caret">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
      )}
      {icon !== undefined ? (
        <span className="rpp-section-icon">{icon}</span>
      ) : (
        <span className="rpp-section-bar" />
      )}
      <span className="rpp-section-title">{title}</span>
      {count !== undefined && <span className="rpp-badge">{count}</span>}
    </div>
  )

  return (
    <section className={`rpp-section${collapsible && !open ? ' is-collapsed' : ''}`}>
      {collapsible ? (
        <button
          type="button"
          className="rpp-section-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          {head}
        </button>
      ) : (
        head
      )}
      {(!collapsible || open) && (
        <>
          {hint && <div className="rpp-section-hint">{hint}</div>}
          <div className="rpp-list">{children}</div>
        </>
      )}
    </section>
  )
}

/**
 * One uniform list row: optional leading icon, label, secondary line,
 * trailing meta and hover-revealed actions.
 */
export function PanelRow({
  icon,
  label,
  sub,
  meta,
  active,
  dimmed,
  onClick,
  actions,
}: {
  icon?: ReactNode
  label: ReactNode
  sub?: string
  meta?: ReactNode
  active?: boolean
  dimmed?: boolean
  /** Receives the click so callers can anchor a popup to the row itself. */
  onClick?: (e: MouseEvent) => void
  actions?: PanelRowAction[]
}) {
  const cls = [
    'rpp-row',
    active ? 'is-active' : '',
    dimmed ? 'is-dimmed' : '',
    onClick ? 'is-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const inner = (
    <>
      {icon !== undefined && <span className="rpp-row-icon">{icon}</span>}
      <span className="rpp-row-main">
        <span className="rpp-row-label">{label}</span>
        {sub && <span className="rpp-row-sub">{sub}</span>}
      </span>
      {meta !== undefined && <span className="rpp-row-meta">{meta}</span>}
    </>
  )

  return (
    <div className={cls}>
      {onClick ? (
        <button type="button" className="rpp-row-hit" onClick={onClick} title={sub ?? undefined}>
          {inner}
        </button>
      ) : (
        <div className="rpp-row-hit rpp-row-hit-static">{inner}</div>
      )}
      {actions && actions.length > 0 && (
        <span className="rpp-row-actions">
          {actions.map((a) => (
            <button
              key={a.title}
              type="button"
              className={`rpp-row-action${a.danger ? ' is-danger' : ''}`}
              title={a.title}
              onClick={(e: MouseEvent) => {
                e.stopPropagation()
                a.onClick()
              }}
            >
              <Icon name={a.icon} size={14} />
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

/** Small accent chip used for tags. */
export function PanelChip({ children }: { children: ReactNode }) {
  return <span className="rpp-chip">{children}</span>
}

/** Placeholder shown when a section has no entries. */
export function PanelNone({ text }: { text: string }) {
  return <div className="rpp-none">{text}</div>
}

/** Ghost button for header actions; `danger` renders the destructive variant. */
export function PanelButton({
  label,
  icon,
  danger,
  disabled,
  onClick,
}: {
  label: string
  icon?: IconName
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`rpp-btn${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      title={label}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={13} />}
      <span className="rpp-btn-label">{label}</span>
    </button>
  )
}

/** Centered empty state: circled icon + title + optional hint. */
export function PanelEmpty({
  icon,
  title,
  hint,
  fill,
}: {
  icon: ReactNode
  title: string
  hint?: string
  /** Stretch to the full view height (whole-page empty states). */
  fill?: boolean
}) {
  return (
    <div className={`rpp-empty${fill ? ' is-fill' : ''}`}>
      <span className="rpp-empty-circle">{icon}</span>
      <span className="rpp-empty-title">{title}</span>
      {hint && <span className="rpp-empty-hint">{hint}</span>}
    </div>
  )
}

/** Shimmering placeholder rows shown while a view scans for data. */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rpp-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="rpp-skeleton-row" />
      ))}
    </div>
  )
}

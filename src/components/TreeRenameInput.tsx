// The rename input used inside a tree row. Extracted so `TreeItem` and
// `StickySection` cannot drift apart on styling or event wiring.
import type { InlineRenameApi } from '../hooks/useInlineRename'

export default function TreeRenameInput({ rename }: { rename: InlineRenameApi }) {
  return (
    <input
      ref={rename.inputRef}
      className="tree-rename-input"
      value={rename.value}
      onChange={(e) => rename.setValue(e.target.value)}
      onKeyDown={rename.handleKeyDown}
      onBlur={rename.commit}
      // The row opens the item on click; typing into the field must not bubble.
      onClick={(e) => e.stopPropagation()}
      style={{
        flex: 1,
        minWidth: 0,
        height: 22,
        padding: '0 4px',
        fontSize: 13,
        border: '1px solid var(--accent)',
        borderRadius: 4,
        outline: 'none',
        background: 'var(--bg-content)',
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
      }}
    />
  )
}

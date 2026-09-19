// Inline rename state machine shared by every tree row that can be renamed
// (files and sticky folder headers). Both used to carry their own copy of the
// edit value, the focus effect and the commit rules.
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'

/** Index of the extension separator, or -1 when the name carries none. */
function extensionIndex(name: string): number {
  const dot = name.lastIndexOf('.')
  // A leading dot marks a hidden file (`.gitignore`), it is not an extension.
  return dot > 0 ? dot : -1
}

export interface InlineRenameApi {
  /** Current field content. */
  value: string
  setValue: (next: string) => void
  inputRef: RefObject<HTMLInputElement>
  /** Commit on blur / Enter: empty or unchanged input counts as a cancel. */
  commit: () => void
  handleKeyDown: (e: KeyboardEvent) => void
}

export interface InlineRenameOptions {
  onCommit: (name: string) => void
  onCancel: () => void
  /**
   * Pre-select only the part before the extension, so typing over it keeps
   * `.md` in place. The extension stays inside the field and can still be
   * edited or deleted — this is a selection hint, not a lock.
   */
  selectStem?: boolean
}

/**
 * @param {boolean} active whether this row is in edit mode right now.
 * @param {string} currentName value to seed (and compare against) on commit.
 * @param {InlineRenameOptions} options
 */
export function useInlineRename(
  active: boolean,
  currentName: string,
  { onCommit, onCancel, selectStem = false }: InlineRenameOptions,
): InlineRenameApi {
  const [value, setValue] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  // Entering edit mode: re-seed the field from the node (it may have been
  // renamed elsewhere) and focus/select it once the input is mounted.
  useEffect(() => {
    if (!active) return
    setValue(currentName)
    const timer = setTimeout(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      const stemEnd = selectStem ? extensionIndex(currentName) : -1
      if (stemEnd > 0) input.setSelectionRange(0, stemEnd)
      else input.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [active, currentName, selectStem])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== currentName) onCommit(trimmed)
    else onCancel()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  return { value, setValue, inputRef, commit, handleKeyDown }
}

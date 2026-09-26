import { Fragment, useMemo } from 'react'
import MarkdownRenderer from '../MarkdownRenderer'
import { Icon } from '../../icons/Icon'
import { mentionName, splitMentions } from '../../../agent/mentions'

interface MentionContentProps {
  content: string
  /** Opens the referenced note when a chip is clicked. */
  onOpenNote: (path: string) => void
}

/**
 * Render chat message text, turning every `@[[path]]` mention into a clickable
 * pill while the surrounding prose still goes through the Markdown renderer.
 */
export function MentionContent({ content, onOpenNote }: MentionContentProps) {
  const segments = useMemo(() => splitMentions(content), [content])
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <Fragment key={i}>
            <MarkdownRenderer content={seg.value} />
          </Fragment>
        ) : (
          <button
            key={i}
            type="button"
            className="buddy-mention-chip"
            title={seg.value}
            onClick={() => onOpenNote(seg.value)}
          >
            <Icon name="file" size={12} />
            {mentionName(seg.value)}
          </button>
        ),
      )}
    </>
  )
}

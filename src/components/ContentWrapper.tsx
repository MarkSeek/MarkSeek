import { useCallback, useState } from 'react'
import EditorTabs from './EditorTabs'
import MainPanel from './MainPanel'
import OutlineGutter from './OutlineGutter'
import DiaryNavGutter from './DiaryNavGutter'

interface ContentWrapperProps {
  leftOpen: boolean
  onToggleLeft: () => void
  rightOpen: boolean
  onToggleRight: () => void
}

export default function ContentWrapper({ leftOpen, onToggleLeft, rightOpen, onToggleRight }: ContentWrapperProps) {
  const [targetHeading, setTargetHeading] = useState<string | null>(null)
  // clear the jump request as soon as the editor consumes it, so it is not replayed during a later editor rebuild
  const consumeTargetHeading = useCallback(() => setTargetHeading(null), [])

  return (
    <div className="content-wrapper">
      <EditorTabs
        leftOpen={leftOpen}
        onToggleLeft={onToggleLeft}
        rightOpen={rightOpen}
        onToggleRight={onToggleRight}
      />
      <div className="content-body">
        <div className="main-panel">
          <div className="editor-area">
            <MainPanel targetHeading={targetHeading} onHeadingConsumed={consumeTargetHeading} />
          </div>
          <OutlineGutter onNavigateHeading={setTargetHeading} />
          <DiaryNavGutter onNavigateHeading={setTargetHeading} />
        </div>
      </div>
    </div>
  )
}

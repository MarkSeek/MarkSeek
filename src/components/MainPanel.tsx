import { type ReactNode } from 'react'
import MilkdownEditor from './MilkdownEditor'
import TextFileViewer from './TextFileViewer'
import ImageViewer from './ImageViewer'
import CalendarPage from './CalendarPage'
import HomePage from './HomePage'
import DiaryPage from './DiaryPage'
import LiteAppPage from './LiteAppPage'
import SettingsView from './SettingsView'
import PluginPage from './PluginPage'
import { useWorkspace } from '../context/WorkspaceContext'
import { useSettings } from '../context/SettingsContext'
import { t } from '../i18n'
import { pluginManager } from '../plugins/PluginManager'
import { usePluginContributions } from '../plugins/usePluginContributions'
import { isMarkdownFile } from '../utils/isMarkdown'
import { isImageFile } from '../utils/isImage'

export default function MainPanel({
  targetHeading,
  onHeadingConsumed,
}: {
  targetHeading?: string | null
  onHeadingConsumed?: () => void
}) {
  const { activeTab, activeTabId, updateContent, openTabs } = useWorkspace()
  useSettings()
  // Plugins load asynchronously; re-render when a page renderer shows up.
  usePluginContributions()

  if (!activeTab) {
    return (
      <div className="editor-area" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
        {t('main.empty')}
      </div>
    )
  }

  // The lite-app virtual page stays mounted: only its visibility toggles, so leaving and
  // returning does not unmount and rebuild the whole LiteAppPage (including its running iframe),
  // which would otherwise fully reload the lite app.
  const isLiteApp = activeTab.id === '__liteapp__'
  const isSettings = activeTab.id === '__settings__'
  // The diary virtual page also stays mounted (visibility toggle only), so leaving and returning
  // does not unmount and rebuild DiaryPage, which would lose the current date/editor content and
  // force a full reload.
  const isDiary = activeTab.kind === 'diary'
  // A plugin may own whole files (e.g. canvas notes): it then takes over the
  // editor area instead of the Markdown editor. The tab is still a plain file
  // tab, so saving, session restore and every open entry point work unchanged.
  const pageRenderer = pluginManager.getPageRenderer(activeTab.path)

  // Whether a diary tab has ever been opened (already present in openTabs). Only mount DiaryPage
  // when one exists, so entering a diary-less workspace for the first time does not conjure an
  // empty editor instance out of nothing.
  const diaryEverOpened = openTabs.some((t) => t.kind === 'diary')

  // Liteapp and diary tabs produce no `main`: they live in the persistent
  // holders below, so the if-chain here decides the whole main area and nothing
  // is built and then thrown away.
  let main: ReactNode = null
  if (activeTab.id === '__home__') {
    main = <HomePage />
  } else if (activeTab.id === '__calendar__') {
    main = <CalendarPage />
  } else if (isSettings) {
    main = <SettingsView />
  } else if (pageRenderer) {
    main = (
      <PluginPage
        // The revision is part of the key: a page reads its document once, on
        // mount, so an outside write has to remount it onto the new content
        // (the editor swaps its document in place instead).
        key={`${activeTabId}:${activeTab.rev ?? 0}`}
        renderer={pageRenderer}
        filePath={activeTab.path}
        content={activeTab.content}
        onChange={(md) => updateContent(activeTab.id, md)}
      />
    )
  } else if (activeTab.kind === 'image' || isImageFile(activeTab.path)) {
    // Pictures get their own viewer instead of the text/markdown editors: the
    // bytes are loaded by the browser from the vault image URL.
    main = <ImageViewer key={activeTabId} path={activeTab.path} name={activeTab.name} />
  } else if (activeTab.kind === 'file' && !isMarkdownFile(activeTab.path)) {
    main = (
      <TextFileViewer
        key={activeTabId}
        value={activeTab.content}
        path={activeTab.path}
        onChange={(text) => updateContent(activeTab.id, text)}
      />
    )
  } else if (!isLiteApp && !isDiary) {
    main = (
      <MilkdownEditor
        // Key is the tab id only: `rev` used to be part of it, so an outside
        // write (agent, calendar task drag) rebuilt the editor. Content now
        // travels through `contentVersion` and is swapped in place.
        key={activeTabId}
        value={activeTab.content}
        contentVersion={activeTab.rev ?? 0}
        onChange={(md) => updateContent(activeTab.id, md)}
        targetHeading={targetHeading}
        onHeadingConsumed={onHeadingConsumed}
        filePath={activeTab.path}
      />
    )
  }

  return (
    <>
      <div
        className="liteapp-holder"
        style={{ display: isLiteApp ? 'block' : 'none', height: '100%', overflow: 'auto' }}
      >
        <LiteAppPage active={isLiteApp} />
      </div>
      {diaryEverOpened && (
        <div
          className="diary-holder"
          style={{ display: isDiary ? 'block' : 'none', height: '100%' }}
        >
          <DiaryPage targetHeading={targetHeading} onHeadingConsumed={onHeadingConsumed} />
        </div>
      )}
      {main}
    </>
  )
}

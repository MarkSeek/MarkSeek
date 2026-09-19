// Rebuild a live tab from the identifiers stored in the session snapshot.
import { readFile } from '../../api/files'
import { t } from '../../i18n'
import { isImageFile } from '../../utils/isImage'
import type { SessionTab } from '../../utils/sessionStorage'
import {
  CALENDAR_ID,
  HOME_ID,
  LITEAPP_PREFIX,
  SETTINGS_ID,
  type Tab,
  fileNameFromPath,
} from './tabsReducer'

/**
 * Returns `null` when the underlying file no longer exists, which makes the
 * caller drop that tab silently. Virtual pages never touch the disk: their
 * title is localised and recomputed by the language effect, so an empty
 * placeholder content is enough.
 *
 * The diary page is deliberately NOT restored here: it is a singleton virtual
 * page that the app already opens on startup (today's entry). Rebuilding it
 * from the snapshot would stack duplicate diary tabs on top of the initial
 * one, so we return `null` for any `kind === 'diary'` entry.
 */
export async function buildRestoredTab(saved: SessionTab): Promise<Tab | null> {
  if (saved.kind === 'calendar') {
    return {
      id: CALENDAR_ID,
      name: t('tab.calendar'),
      path: CALENDAR_ID,
      content: '',
      dirty: false,
      kind: 'calendar',
    }
  }
  if (saved.kind === 'liteapp') {
    return {
      id: LITEAPP_PREFIX,
      name: t('tab.liteapp'),
      path: LITEAPP_PREFIX,
      content: '',
      dirty: false,
      kind: 'liteapp',
    }
  }
  if (saved.kind === 'settings') {
    return {
      id: SETTINGS_ID,
      name: t('tab.settings'),
      path: SETTINGS_ID,
      content: '',
      dirty: false,
      kind: 'settings',
    }
  }
  if (saved.id === HOME_ID) {
    return {
      id: HOME_ID,
      name: t('tab.home'),
      path: HOME_ID,
      content: '',
      dirty: false,
    }
  }
  if (saved.kind === 'diary') {
    // The diary singleton is reopened by the startup default (today's entry),
    // never from the snapshot — restoring it would create duplicate tabs.
    return null
  }
  // Pictures are binary: the viewer loads them from the vault image URL, so
  // restoring one must never read the bytes as text.
  if (saved.kind === 'image' || isImageFile(saved.path)) {
    return {
      id: saved.path,
      name: fileNameFromPath(saved.path),
      path: saved.path,
      content: '',
      dirty: false,
      kind: 'image',
    }
  }
  try {
    const content = await readFile(saved.path)
    return {
      id: saved.path,
      name: fileNameFromPath(saved.path),
      path: saved.path,
      content,
      dirty: false,
      kind: 'file',
    }
  } catch {
    // Deleted or renamed note: skip it instead of showing a broken tab.
    return null
  }
}

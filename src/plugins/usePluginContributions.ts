// React binding for plugin contributions.
//
// Plugins load asynchronously, after the first paint, so anything that reads a
// contribution (a page renderer, a tab icon) has to re-render once they land.
// This hook starts the load if nobody has asked for it yet and subscribes the
// caller to later changes. It knows nothing about what plugins contribute.
import { useEffect, useSyncExternalStore } from 'react'
import { pluginManager } from './PluginManager'

// Module-level so the identities stay stable across renders, as
// useSyncExternalStore requires.
const subscribe = (onChange: () => void) => pluginManager.subscribe(onChange)
const getRevision = () => pluginManager.getContributionRevision()

/**
 * Re-render whenever a plugin registers a contribution, and kick off plugin
 * loading when this is the first caller.
 */
export function usePluginContributions(): void {
  useEffect(() => {
    void pluginManager.ready()
  }, [])
  useSyncExternalStore(subscribe, getRevision)
}

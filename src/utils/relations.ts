// Re-export shim.
//
// The implementation moved to shared/relations.mjs so the Node backend (which
// now runs the whole-vault scan) and the browser share one copy of the rules.
// The panel itself no longer calls these directly — it asks the backend — but
// every existing import path keeps working unchanged.
export * from '../../shared/relations.mjs'

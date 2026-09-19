// Re-export shim.
//
// The implementation moved to shared/wiki-link.mjs so the Node backend (which
// now runs the whole-vault relation scan) and the browser share one copy of
// the parsing rules. Every existing import path keeps working unchanged.
export * from '../../shared/wiki-link.mjs'

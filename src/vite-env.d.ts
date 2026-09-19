/// <reference types="vite/client" />

// `vite/client` declares `*.css` without an export (it is a side-effect import)
// and does not cover the `?inline` query at all, so the string form used to
// inline a stylesheet into a bundle needs its own declaration.
declare module '*.css?inline' {
  const css: string
  export default css
}

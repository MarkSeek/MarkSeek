/** A file is opened in Crepe (the Markdown editor) only when it ends with `.md`. */
export function isMarkdownFile(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

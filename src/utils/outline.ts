export interface Heading {
  level: number
  text: string
}

export interface HeadingNode extends Heading {
  children: HeadingNode[]
}

export function parseHeadings(markdown: string): Heading[] {
  const headings: Heading[] = []
  const regex = /^(#{1,6})\s+(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(markdown)) !== null) {
    headings.push({ level: match[1].length, text: match[2].trim() })
  }
  return headings
}

export function buildTree(headings: Heading[]): HeadingNode[] {
  const tree: HeadingNode[] = []
  const ancestors: HeadingNode[] = []

  for (const h of headings) {
    const node: HeadingNode = { level: h.level, text: h.text, children: [] }
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= h.level) {
      ancestors.pop()
    }
    if (ancestors.length > 0) {
      ancestors[ancestors.length - 1].children.push(node)
    } else {
      tree.push(node)
    }
    ancestors.push(node)
  }
  return tree
}

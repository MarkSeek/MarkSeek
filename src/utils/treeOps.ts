// Pure helpers for the file tree.
//
// These used to live inside WorkspaceContext as functions declared on every
// render. They are pure and side-effect free, so they can be unit tested
// without mounting a provider.
import type { TreeNode } from '../api/files'

/** Return the children of `targetId`, or `null` when the node is not in the tree. */
export function findNodeChildren(nodes: TreeNode[], targetId: string): TreeNode[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return node.children || []
    if (node.children) {
      const result = findNodeChildren(node.children, targetId)
      if (result !== null) return result
    }
  }
  return null
}

/** Return the node with `targetId`, or `null` when it is not in the tree. */
export function findNode(nodes: TreeNode[], targetId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === targetId) return node
    if (node.children) {
      const result = findNode(node.children, targetId)
      if (result) return result
    }
  }
  return null
}

/**
 * Sort tree entries the way the sidebar renders them: folders first, then
 * files, each group ordered by name.
 */
export function sortTreeNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
  return a.name.localeCompare(b.name, 'zh')
}

/**
 * Replace the children of one directory. Only the path down to that node is
 * cloned, so the rest of the tree keeps its identity (and its render output).
 */
export function updateNodeChildren(
  nodes: TreeNode[],
  dirPath: string,
  children: TreeNode[],
): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === dirPath) return { ...n, children }
    if (n.children) return { ...n, children: updateNodeChildren(n.children, dirPath, children) }
    return n
  })
}

/**
 * Insert a node under `parentPath`, keeping the children sorted.
 * An empty `parentPath` targets the vault root, which is the folder node that
 * carries no id of its own.
 */
export function insertNode(tree: TreeNode[], parentPath: string, newNode: TreeNode): TreeNode[] {
  if (!parentPath) {
    return tree.map((node) => {
      if (!node.id && node.type === 'folder' && node.children) {
        const updated = [...node.children, newNode].sort(sortTreeNodes)
        return { ...node, children: updated }
      }
      return node
    })
  }
  return tree.map((node) => {
    if (node.id === parentPath && node.children) {
      const updated = [...node.children, newNode].sort(sortTreeNodes)
      return { ...node, children: updated }
    }
    if (node.children) {
      return { ...node, children: insertNode(node.children, parentPath, newNode) }
    }
    return node
  })
}

/**
 * Every markdown path in the tree, depth-first.
 * Shared by the relation panel and the wikilink resolver so both see the same
 * set of notes (and neither has to re-walk the tree in its own way).
 */
export function collectMarkdownPaths(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type === 'folder') {
        if (node.children) walk(node.children)
      } else if (/\.(md|markdown)$/i.test(node.id)) {
        out.push(node.id)
      }
    }
  }
  walk(nodes)
  return out
}

/** Remove the node with `targetId` (a whole subtree when it is a folder). */
export function removeNode(tree: TreeNode[], targetId: string): TreeNode[] {
  return tree
    .filter((node) => node.id !== targetId)
    .map((node) => {
      if (node.children) {
        return { ...node, children: removeNode(node.children, targetId) }
      }
      return node
    })
}

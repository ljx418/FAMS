import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { DOMParser } from '@xmldom/xmldom'

const docsDir = path.dirname(new URL(import.meta.url).pathname)
const inputFiles = process.argv.slice(2)

const files = inputFiles.length
  ? inputFiles.map((file) => path.resolve(process.cwd(), file))
  : fs
      .readdirSync(docsDir)
      .filter((file) => file.endsWith('.drawio'))
      .sort()
      .map((file) => path.join(docsDir, file))

const parser = new DOMParser()

function attr(node, name) {
  return node.getAttribute(name) || ''
}

function decodeText(value) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' / ')
}

function listNodes(root) {
  return Array.from(root.getElementsByTagName('mxCell'))
    .filter((cell) => attr(cell, 'vertex') === '1')
    .map((cell) => ({
      id: attr(cell, 'id'),
      label: decodeText(attr(cell, 'value')),
      parent: attr(cell, 'parent'),
    }))
    .filter((node) => node.label)
}

function listEdges(root, nodesById) {
  return Array.from(root.getElementsByTagName('mxCell'))
    .filter((cell) => attr(cell, 'edge') === '1')
    .map((cell) => {
      const source = attr(cell, 'source')
      const target = attr(cell, 'target')
      const label = decodeText(attr(cell, 'value'))
      return {
        source: nodesById.get(source) || source || '?',
        target: nodesById.get(target) || target || '?',
        label,
      }
    })
}

for (const file of files) {
  const xml = fs.readFileSync(file, 'utf8')
  const doc = parser.parseFromString(xml, 'application/xml')
  const diagrams = Array.from(doc.getElementsByTagName('diagram'))

  console.log(`\n# ${path.relative(process.cwd(), file)}`)

  for (const diagram of diagrams) {
    const model = diagram.getElementsByTagName('mxGraphModel')[0]
    if (!model) {
      console.log(`\n## ${attr(diagram, 'name') || attr(diagram, 'id')}`)
      console.log('Compressed or embedded diagram payload; open with diagrams.net to inspect visually.')
      continue
    }

    const nodes = listNodes(model)
    const nodesById = new Map(nodes.map((node) => [node.id, node.label]))
    const edges = listEdges(model, nodesById)

    console.log(`\n## ${attr(diagram, 'name') || attr(diagram, 'id')}`)
    console.log(`Nodes: ${nodes.length}; Edges: ${edges.length}`)

    if (nodes.length) {
      console.log('\nNodes')
      for (const node of nodes) {
        console.log(`- ${node.label}`)
      }
    }

    if (edges.length) {
      console.log('\nEdges')
      for (const edge of edges) {
        const label = edge.label ? ` (${edge.label})` : ''
        console.log(`- ${edge.source} -> ${edge.target}${label}`)
      }
    }
  }
}

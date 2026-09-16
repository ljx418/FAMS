import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { DOMParser } from '@xmldom/xmldom'

const docsDir = path.dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
const outputArg = args.find((arg) => arg.startsWith('--output='))
const outputFile = outputArg ? path.resolve(process.cwd(), outputArg.slice('--output='.length)) : null
const inputFiles = args.filter((arg) => !arg.startsWith('--output='))
const outputLines = []

function emit(line = '') {
  outputLines.push(line)
  console.log(line)
}

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

  emit(`\n# ${path.relative(process.cwd(), file)}`)

  for (const diagram of diagrams) {
    const model = diagram.getElementsByTagName('mxGraphModel')[0]
    if (!model) {
      emit(`\n## ${attr(diagram, 'name') || attr(diagram, 'id')}`)
      emit('Compressed or embedded diagram payload; open with diagrams.net to inspect visually.')
      continue
    }

    const nodes = listNodes(model)
    const nodesById = new Map(nodes.map((node) => [node.id, node.label]))
    const edges = listEdges(model, nodesById)

    emit(`\n## ${attr(diagram, 'name') || attr(diagram, 'id')}`)
    emit(`Nodes: ${nodes.length}; Edges: ${edges.length}`)

    if (nodes.length) {
      emit('\nNodes')
      for (const node of nodes) {
        emit(`- ${node.label}`)
      }
    }

    if (edges.length) {
      emit('\nEdges')
      for (const edge of edges) {
        const label = edge.label ? ` (${edge.label})` : ''
        emit(`- ${edge.source} -> ${edge.target}${label}`)
      }
    }
  }
}

if (outputFile) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true })
  fs.writeFileSync(outputFile, `${outputLines.join('\n').trimStart()}\n`, 'utf8')
}

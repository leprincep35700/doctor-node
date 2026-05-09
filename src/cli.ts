#!/usr/bin/env node
import { resolve } from 'node:path'
import { scan } from './analyzer.js'
import type { ScanOptions } from './types.js'
import { DEFAULT_MAX_FILES } from './constants.js'

interface CliArgs {
  root: string
  json: boolean
  minScore?: number
  includeTests: boolean
  maxFiles: number
  help: boolean
  version: boolean
}

const parseBoundedInteger = (option: string, value: string | undefined, minimum: number, maximum: number): number => {
  if (!value) throw new Error(`${option} requires a number`)
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${option} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = { root: '.', json: false, includeTests: false, maxFiles: DEFAULT_MAX_FILES, help: false, version: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg) continue
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--version' || arg === '-v') args.version = true
    else if (arg === '--json') args.json = true
    else if (arg === '--include-tests') args.includeTests = true
    else if (arg === '--min-score') {
      args.minScore = parseBoundedInteger('--min-score', argv[index + 1], 0, 100)
      index += 1
    } else if (arg === '--max-files') {
      args.maxFiles = parseBoundedInteger('--max-files', argv[index + 1], 1, 100_000)
      index += 1
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      args.root = arg
    }
  }
  return args
}

const help = `Doctor Node 0.1.0

Usage:
  doctor-node [path] [options]

Options:
  --json              Print machine-readable JSON
  --min-score <n>     Exit 1 when score is below n
  --include-tests     Include test/spec files in source pattern checks
  --max-files <n>     Max source files to scan, default ${DEFAULT_MAX_FILES}
  -v, --version       Print version
  -h, --help          Show help

Repository: https://github.com/leprincep35700/doctor-node
`

const formatText = (result: Awaited<ReturnType<typeof scan>>): string => {
  const lines: string[] = []
  lines.push(`Doctor Node report for ${result.root}`)
  lines.push('')
  lines.push(`Score: ${result.score}/100 — ${result.grade}`)
  lines.push(`Diagnostics: ${result.diagnostics.length} (${result.counts.error} errors, ${result.counts.warning} warnings, ${result.counts.info} info)`)
  lines.push(`Source files scanned: ${result.scannedFiles}`)
  if (result.packageManager) lines.push(`Package manager: ${result.packageManager}`)
  lines.push(`Frameworks: ${result.frameworks.length > 0 ? result.frameworks.map((framework) => `${framework.name} (${framework.confidence}%)`).join(', ') : 'generic Node.js'}`)
  lines.push('')
  for (const item of result.diagnostics.slice(0, 80)) {
    const location = item.file ? `${item.file}${item.line ? `:${item.line}` : ''}` : 'project'
    lines.push(`${item.severity.toUpperCase()} ${item.id} — ${item.title}`)
    lines.push(`  ${location}`)
    lines.push(`  ${item.message}`)
    lines.push(`  Fix: ${item.suggestion}`)
    lines.push('')
  }
  if (result.diagnostics.length > 80) lines.push(`… ${result.diagnostics.length - 80} more diagnostics hidden. Use --json for full output.`)
  return lines.join('\n')
}

const main = async (): Promise<void> => {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
      console.log(help)
      return
    }
    if (args.version) {
      console.log('0.1.0')
      return
    }
    const options: ScanOptions = {
      root: resolve(args.root),
      json: args.json,
      includeTests: args.includeTests,
      maxFiles: args.maxFiles,
      ...(args.minScore === undefined ? {} : { minScore: args.minScore }),
    }
    const result = await scan(options)
    if (args.json) console.log(JSON.stringify(result, null, 2))
    else console.log(formatText(result))
    if (args.minScore !== undefined && result.score < args.minScore) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

await main()

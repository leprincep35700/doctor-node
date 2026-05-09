import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { IGNORED_DIRECTORIES, MAX_FILE_BYTES, SOURCE_EXTENSIONS, TEST_FILE_PATTERN } from './constants.js'

export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export const readJsonFile = async <Value>(path: string): Promise<Value | undefined> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Value
  } catch {
    return undefined
  }
}

export const readTextFile = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

export const collectSourceFiles = async (root: string, includeTests: boolean, maxFiles: number): Promise<string[]> => {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= maxFiles) return
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= maxFiles) return
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const extension = extname(entry.name)
      const relativePath = toPosix(relative(root, fullPath))
      if (!SOURCE_EXTENSIONS.includes(extension)) continue
      if (!includeTests && TEST_FILE_PATTERN.test(relativePath)) continue
      const info = await stat(fullPath).catch(() => undefined)
      if (info && info.size <= MAX_FILE_BYTES) files.push(fullPath)
    }
  }
  await visit(root)
  return files
}

export const toPosix = (path: string): string => path.split('\\').join('/')

export const lineOf = (content: string, index: number): number => content.slice(0, Math.max(0, index)).split('\n').length

export const hasDependency = (packageJson: PackageJson | undefined, names: string[]): boolean => {
  const allDependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
    ...packageJson?.optionalDependencies,
  }
  return names.some((name) => Boolean(allDependencies[name]))
}

export const allDependencyNames = (packageJson: PackageJson | undefined): string[] => Object.keys({
  ...packageJson?.dependencies,
  ...packageJson?.devDependencies,
  ...packageJson?.peerDependencies,
  ...packageJson?.optionalDependencies,
})

export const compactPath = (root: string, path: string): string => toPosix(relative(root, path)) || basename(path)

export interface PackageJson {
  name?: string
  version?: string
  type?: string
  packageManager?: string
  engines?: Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

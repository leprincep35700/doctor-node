import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { IGNORED_DIRECTORIES, MAX_FILE_BYTES, SOURCE_EXTENSIONS, TEST_FILE_PATTERN } from './constants.js';
export const fileExists = async (path) => {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
};
export const readJsonFile = async (path) => {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    }
    catch {
        return undefined;
    }
};
export const readTextFile = async (path) => {
    try {
        return await readFile(path, 'utf8');
    }
    catch {
        return undefined;
    }
};
export const collectSourceFiles = async (root, includeTests, maxFiles) => {
    const files = [];
    const visit = async (directory) => {
        if (files.length >= maxFiles)
            return;
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (files.length >= maxFiles)
                return;
            const fullPath = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name))
                    await visit(fullPath);
                continue;
            }
            if (!entry.isFile())
                continue;
            const extension = extname(entry.name);
            const relativePath = toPosix(relative(root, fullPath));
            if (!SOURCE_EXTENSIONS.includes(extension))
                continue;
            if (!includeTests && TEST_FILE_PATTERN.test(relativePath))
                continue;
            const info = await stat(fullPath).catch(() => undefined);
            if (info && info.size <= MAX_FILE_BYTES)
                files.push(fullPath);
        }
    };
    await visit(root);
    return files;
};
export const toPosix = (path) => path.split('\\').join('/');
export const lineOf = (content, index) => content.slice(0, Math.max(0, index)).split('\n').length;
export const hasDependency = (packageJson, names) => {
    const allDependencies = {
        ...packageJson?.dependencies,
        ...packageJson?.devDependencies,
        ...packageJson?.peerDependencies,
        ...packageJson?.optionalDependencies,
    };
    return names.some((name) => Boolean(allDependencies[name]));
};
export const allDependencyNames = (packageJson) => Object.keys({
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
    ...packageJson?.optionalDependencies,
});
export const compactPath = (root, path) => toPosix(relative(root, path)) || basename(path);
//# sourceMappingURL=utils.js.map
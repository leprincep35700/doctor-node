export const DEFAULT_MAX_FILES = 1500;
export const MAX_FILE_BYTES = 500_000;
export const ERROR_WEIGHT = 6;
export const WARNING_WEIGHT = 2;
export const INFO_WEIGHT = 0.5;
export const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
export const TEST_FILE_PATTERN = /(^|[./_-])(test|spec|e2e|fixture|mock)s?([./_-]|$)/i;
export const IGNORED_DIRECTORIES = new Set([
    '.git',
    '.next',
    '.nuxt',
    '.output',
    '.svelte-kit',
    '.turbo',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'out',
]);
//# sourceMappingURL=constants.js.map
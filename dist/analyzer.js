import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ERROR_WEIGHT, INFO_WEIGHT, WARNING_WEIGHT } from './constants.js';
import { detectFrameworks } from './frameworks.js';
import { allDependencyNames, collectSourceFiles, compactPath, fileExists, lineOf, readJsonFile, readTextFile, toPosix } from './utils.js';
const diagnostic = (input) => input;
const push = (diagnostics, input) => {
    diagnostics.push(diagnostic(input));
};
const packageManagerByLockfile = {
    'package-lock.json': 'npm',
    'npm-shrinkwrap.json': 'npm',
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'bun.lockb': 'bun',
    'bun.lock': 'bun',
};
const lockfiles = Object.keys(packageManagerByLockfile);
const detectPackageManager = async (root, packageJson) => {
    if (packageJson?.packageManager)
        return packageJson.packageManager.split('@')[0];
    for (const lockfile of lockfiles) {
        if (await fileExists(join(root, lockfile)))
            return packageManagerByLockfile[lockfile];
    }
    return undefined;
};
const scanProjectConfig = async (root, packageJson, diagnostics) => {
    if (!packageJson) {
        push(diagnostics, {
            id: 'node.package-json.missing',
            title: 'Missing package.json',
            severity: 'error',
            category: 'config',
            message: 'No package.json was found at the project root.',
            suggestion: 'Run Doctor Node at the root of a Node.js package or create a package.json.',
            file: 'package.json',
        });
        return;
    }
    if (!packageJson.engines?.node) {
        push(diagnostics, {
            id: 'node.engines.missing',
            title: 'Node engine is not pinned',
            severity: 'warning',
            category: 'config',
            message: 'package.json does not declare engines.node, so production and CI can drift across Node versions.',
            suggestion: 'Add an engines.node range such as >=20 and align CI/runtime with it.',
            file: 'package.json',
        });
    }
    const scripts = packageJson.scripts ?? {};
    for (const [scriptName, category] of [['test', 'testing'], ['lint', 'maintainability'], ['typecheck', 'typescript']]) {
        if (!scripts[scriptName]) {
            push(diagnostics, {
                id: `node.script.${scriptName}.missing`,
                title: `Missing ${scriptName} script`,
                severity: scriptName === 'test' ? 'warning' : 'info',
                category,
                message: `package.json has no ${scriptName} script, making CI quality gates less standard.`,
                suggestion: `Add a ${scriptName} script and run it in CI.`,
                file: 'package.json',
            });
        }
    }
    const presentLockfiles = [];
    for (const lockfile of lockfiles) {
        if (await fileExists(join(root, lockfile)))
            presentLockfiles.push(lockfile);
    }
    if (presentLockfiles.length > 1) {
        push(diagnostics, {
            id: 'node.lockfiles.mixed',
            title: 'Multiple package-manager lockfiles',
            severity: 'warning',
            category: 'dependencies',
            message: `Found multiple lockfiles: ${presentLockfiles.join(', ')}.`,
            suggestion: 'Keep only the lockfile for the package manager used by the project.',
        });
    }
    if (!(await fileExists(join(root, '.env.example'))) && !(await fileExists(join(root, '.env.template')))) {
        push(diagnostics, {
            id: 'node.env.example.missing',
            title: 'No environment variable template',
            severity: 'info',
            category: 'config',
            message: 'No .env.example or .env.template file was found.',
            suggestion: 'Add a sanitized env template documenting required variables without secrets.',
        });
    }
    if (await fileExists(join(root, '.env'))) {
        push(diagnostics, {
            id: 'node.env.committed',
            title: 'Root .env file present',
            severity: 'error',
            category: 'security',
            message: 'A root .env file exists in the scanned tree. If committed, this often leaks secrets.',
            suggestion: 'Ensure .env is gitignored and move safe examples to .env.example.',
            file: '.env',
        });
    }
};
const scanTypeScript = async (root, diagnostics) => {
    const tsconfigPath = join(root, 'tsconfig.json');
    const tsconfig = await readJsonFile(tsconfigPath);
    if (!tsconfig)
        return;
    const compilerOptions = (tsconfig.compilerOptions ?? {});
    if (compilerOptions.strict !== true) {
        push(diagnostics, {
            id: 'node.ts.strict.disabled',
            title: 'TypeScript strict mode is not enabled',
            severity: 'warning',
            category: 'typescript',
            message: 'strict mode catches nullability, implicit any, and unsafe contracts early.',
            suggestion: 'Set compilerOptions.strict to true and suppress only intentional exceptions.',
            file: 'tsconfig.json',
        });
    }
    const excluded = Array.isArray(tsconfig.exclude) ? tsconfig.exclude.map(String) : [];
    if (!excluded.some((entry) => ['dist', 'build', '.next', '.nuxt'].some((folder) => entry.includes(folder)))) {
        push(diagnostics, {
            id: 'node.ts.exclude.generated',
            title: 'Generated folders are not explicitly excluded',
            severity: 'info',
            category: 'typescript',
            message: 'tsconfig.json does not clearly exclude generated output folders.',
            suggestion: 'Exclude dist/build/framework output folders to avoid stale generated files affecting typecheck.',
            file: 'tsconfig.json',
        });
    }
};
const scanOperations = async (root, diagnostics) => {
    const hasDockerfile = await fileExists(join(root, 'Dockerfile'));
    if (hasDockerfile && !(await fileExists(join(root, '.dockerignore')))) {
        push(diagnostics, {
            id: 'node.dockerignore.missing',
            title: 'Dockerfile without .dockerignore',
            severity: 'warning',
            category: 'performance',
            message: 'Docker builds can accidentally include node_modules, secrets, logs and local artifacts.',
            suggestion: 'Add .dockerignore with node_modules, .git, .env*, coverage and build outputs.',
            file: 'Dockerfile',
        });
    }
    const dockerfile = hasDockerfile ? await readTextFile(join(root, 'Dockerfile')) : undefined;
    if (dockerfile && !/HEALTHCHECK/i.test(dockerfile)) {
        push(diagnostics, {
            id: 'node.docker.healthcheck.missing',
            title: 'Docker image has no healthcheck',
            severity: 'info',
            category: 'observability',
            message: 'The Dockerfile does not declare a HEALTHCHECK.',
            suggestion: 'Add a lightweight health endpoint and Docker HEALTHCHECK for long-running services.',
            file: 'Dockerfile',
        });
    }
    const workflows = await readdir(join(root, '.github/workflows')).catch(() => []);
    if (workflows.length === 0) {
        push(diagnostics, {
            id: 'node.ci.missing',
            title: 'No GitHub Actions workflow detected',
            severity: 'info',
            category: 'testing',
            message: 'No workflows were found in .github/workflows.',
            suggestion: 'Add CI running install, typecheck, lint, tests and build on pull requests.',
        });
    }
};
const scanDependencyUsage = (packageJson, snapshots, diagnostics) => {
    const dependencyNames = allDependencyNames(packageJson).filter((dependency) => !dependency.startsWith('@types/'));
    const combinedSource = snapshots.map((snapshot) => snapshot.content).join('\n');
    const maybeRuntimeDependencies = dependencyNames.filter((dependency) => {
        if (dependency.startsWith('@'))
            return !combinedSource.includes(dependency);
        const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !new RegExp(`['\"]${escaped}(/|['\"])`).test(combinedSource) && !new RegExp(`from\\s+['\"]${escaped}(/|['\"])`).test(combinedSource);
    });
    for (const dependency of maybeRuntimeDependencies.slice(0, 12)) {
        push(diagnostics, {
            id: 'node.dependency.possibly-unused',
            title: `Possibly unused dependency: ${dependency}`,
            severity: 'info',
            category: 'dependencies',
            message: `${dependency} is listed in package.json but was not found in scanned source imports.`,
            suggestion: 'Verify with knip/depcheck before removing; generated or dynamic imports can be false positives.',
            file: 'package.json',
        });
    }
};
const routeLooksProtected = (content) => /requireUser|requireAuth|getServerSession|currentUser|passport|clerk|lucia|betterAuth|middleware|\.authenticate\(|verifyToken|verifyJwt|verifySession|assertUser|authorize/i.test(content);
const scanSourcePatterns = (frameworks, snapshots, diagnostics) => {
    const frameworkNames = new Set(frameworks.map((framework) => framework.name));
    for (const snapshot of snapshots) {
        const { content, relativePath } = snapshot;
        const checks = [
            [/\beval\s*\(/, { id: 'node.security.eval', title: 'eval usage detected', severity: 'error', category: 'security', message: 'eval executes arbitrary strings and is almost never safe in server-side code.', suggestion: 'Replace eval with explicit parsing, a safe interpreter, or a whitelisted dispatch table.', file: relativePath }],
            [/\bnew\s+Function\s*\(/, { id: 'node.security.function-constructor', title: 'Function constructor usage detected', severity: 'error', category: 'security', message: 'new Function has the same code-execution risks as eval.', suggestion: 'Avoid dynamic code execution and use explicit functions or safe expression parsing.', file: relativePath }],
            [/child_process.*\.exec\s*\([^)]*`/, { id: 'node.security.exec-template', title: 'Shell exec with template literal', severity: 'error', category: 'security', message: 'Template literals passed to child_process.exec can become command injection vulnerabilities.', suggestion: 'Use execFile/spawn with argument arrays and validate every user-controlled value.', file: relativePath }],
            [/jwt\.verify\s*\([^)]*\)(?![\s\S]{0,160}algorithms)/, { id: 'node.security.jwt-algorithms', title: 'JWT verification may not pin algorithms', severity: 'warning', category: 'security', message: 'jwt.verify appears without an algorithms allowlist nearby.', suggestion: 'Pass an algorithms allowlist and validate issuer/audience where applicable.', file: relativePath }],
            [/cors\s*\(\s*\{[^}]*origin\s*:\s*['\"]\*['\"]/, { id: 'node.security.cors-wildcard', title: 'Wildcard CORS origin', severity: 'warning', category: 'security', message: 'CORS is configured with origin "*".', suggestion: 'Use explicit allowed origins, especially when credentials or private APIs are involved.', file: relativePath }],
            [/for\s*(?:await)?\s*\([^)]*\)\s*\{[\s\S]{0,500}\bawait\b/, { id: 'node.performance.await-in-loop', title: 'await inside loop', severity: 'warning', category: 'performance', message: 'A loop awaits work sequentially; this can be correct but often hides avoidable latency.', suggestion: 'Use Promise.all with a concurrency limit when iterations are independent.', file: relativePath }],
            [/\.then\s*\([^)]*\)(?!\s*\.catch)/, { id: 'node.reliability.promise-without-catch', title: 'Promise chain without catch', severity: 'info', category: 'maintainability', message: 'A .then chain appears without a nearby .catch.', suggestion: 'Return/await it in a try/catch or add a rejection handler.', file: relativePath }],
            [/process\.env\.[A-Z0-9_]+\s*\|\|\s*['\"][^'\"]+['\"]/, { id: 'node.config.env-default', title: 'Environment variable has silent fallback', severity: 'info', category: 'config', message: 'A process.env value falls back silently to a hardcoded default.', suggestion: 'Validate environment at startup and fail fast for required settings.', file: relativePath }],
            [/(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9_\-]{20,}['\"]/i, { id: 'node.security.hardcoded-secret', title: 'Possible hardcoded secret', severity: 'error', category: 'security', message: 'A variable/property name associated with secrets contains a long literal value.', suggestion: 'Move secrets to environment/secret manager and rotate if this was committed.', file: relativePath }],
        ];
        for (const [pattern, baseDiagnostic] of checks) {
            const match = pattern.exec(content);
            if (match) {
                push(diagnostics, { ...baseDiagnostic, line: lineOf(content, match.index) });
            }
        }
        if (frameworkNames.has('Express') && /express\s*\(/.test(content)) {
            if (!/helmet\s*\(/.test(content)) {
                push(diagnostics, { id: 'node.express.helmet.missing', title: 'Express app missing Helmet', severity: 'warning', category: 'framework', framework: 'Express', message: 'This file creates an Express app but does not appear to install Helmet.', suggestion: 'Use helmet() near app initialization unless another edge layer sets equivalent headers.', file: relativePath });
            }
            if (!/rateLimit|rateLimiter|express-rate-limit/.test(content)) {
                push(diagnostics, { id: 'node.express.rate-limit.missing', title: 'Express app missing rate limiting signal', severity: 'info', category: 'framework', framework: 'Express', message: 'No obvious rate limiter was found near Express app setup.', suggestion: 'Add route-level or edge-level rate limits for public/auth-sensitive endpoints.', file: relativePath });
            }
        }
        if (frameworkNames.has('Fastify') && /fastify\s*\(/.test(content) && !/logger\s*:\s*true|logger\s*:\s*\{/.test(content)) {
            push(diagnostics, { id: 'node.fastify.logger.disabled', title: 'Fastify logger not enabled', severity: 'info', category: 'observability', framework: 'Fastify', message: 'Fastify is initialized without an obvious logger configuration.', suggestion: 'Enable Fastify logger or wire your structured logger explicitly.', file: relativePath });
        }
        if (frameworkNames.has('NestJS') && /NestFactory\.create/.test(content) && !/ValidationPipe/.test(content)) {
            push(diagnostics, { id: 'node.nest.validation-pipe.missing', title: 'NestJS bootstrap missing ValidationPipe', severity: 'warning', category: 'framework', framework: 'NestJS', message: 'NestFactory bootstrap does not show a global ValidationPipe.', suggestion: 'Use app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })) or document route-level validation.', file: relativePath });
        }
        const isApiRoute = /(^|\/)(api|routes?|server)(\/|\.)/i.test(relativePath) || /route\.(ts|js)$/.test(relativePath) || /\+server\.(ts|js)$/.test(relativePath);
        const containsMutatingRoute = /(export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)|router\.(post|put|patch|delete)|app\.(post|put|patch|delete))/.test(content);
        if ((isApiRoute || containsMutatingRoute) && containsMutatingRoute && !routeLooksProtected(content)) {
            push(diagnostics, { id: 'node.api.mutating-route-auth-signal-missing', title: 'Mutating API route has no obvious auth signal', severity: 'warning', category: 'security', message: 'A mutating route was found without nearby auth/session/JWT verification signals.', suggestion: 'Confirm the route is intentionally public or add explicit authentication/authorization middleware.', file: relativePath });
        }
        if ((frameworkNames.has('Remix') || frameworkNames.has('SvelteKit') || frameworkNames.has('Astro') || frameworkNames.has('Nuxt/Nitro')) && /export\s+(const|async function)\s+(action|POST|PUT|PATCH|DELETE)/.test(content) && !routeLooksProtected(content)) {
            push(diagnostics, { id: 'node.meta-framework.action-auth-signal-missing', title: 'Framework action endpoint lacks obvious auth signal', severity: 'warning', category: 'security', message: 'A server action/mutation endpoint was found without visible auth checks.', suggestion: 'Add an explicit auth guard or document why the endpoint is public.', file: relativePath });
        }
    }
};
const scoreResult = (diagnostics) => {
    const penalty = diagnostics.reduce((total, item) => {
        if (item.severity === 'error')
            return total + ERROR_WEIGHT;
        if (item.severity === 'warning')
            return total + WARNING_WEIGHT;
        return total + INFO_WEIGHT;
    }, 0);
    return Math.max(0, Math.round(100 - penalty));
};
const gradeFor = (score) => {
    if (score >= 90)
        return 'Excellent';
    if (score >= 75)
        return 'Good';
    if (score >= 60)
        return 'Needs work';
    return 'High risk';
};
export const scan = async (options) => {
    const root = options.root;
    const packageJson = await readJsonFile(join(root, 'package.json'));
    const diagnostics = [];
    const packageManager = await detectPackageManager(root, packageJson);
    const frameworks = await detectFrameworks(root, packageJson);
    await scanProjectConfig(root, packageJson, diagnostics);
    await scanTypeScript(root, diagnostics);
    await scanOperations(root, diagnostics);
    const sourceFiles = await collectSourceFiles(root, options.includeTests, options.maxFiles);
    const snapshots = [];
    for (const sourceFile of sourceFiles) {
        const content = await readTextFile(sourceFile);
        if (content !== undefined)
            snapshots.push({ path: sourceFile, relativePath: toPosix(relative(root, sourceFile)), content });
    }
    scanDependencyUsage(packageJson, snapshots, diagnostics);
    scanSourcePatterns(frameworks, snapshots, diagnostics);
    const counts = { error: 0, warning: 0, info: 0 };
    for (const item of diagnostics)
        counts[item.severity] += 1;
    const sortedDiagnostics = diagnostics.sort((left, right) => {
        const severityRank = { error: 0, warning: 1, info: 2 };
        return severityRank[left.severity] - severityRank[right.severity] || (left.file ?? '').localeCompare(right.file ?? '') || left.title.localeCompare(right.title);
    }).map((item) => item.file ? { ...item, file: compactPath(root, join(root, item.file)) } : item);
    const score = scoreResult(sortedDiagnostics);
    return {
        root,
        score,
        grade: gradeFor(score),
        frameworks,
        diagnostics: sortedDiagnostics,
        counts,
        scannedFiles: snapshots.length,
        ...(packageManager === undefined ? {} : { packageManager }),
    };
};
//# sourceMappingURL=analyzer.js.map
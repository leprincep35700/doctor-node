import { join } from 'node:path';
import { fileExists, hasDependency } from './utils.js';
const addSignal = (signals, name, confidence, reason) => {
    const existing = signals.find((signal) => signal.name === name);
    if (existing) {
        existing.confidence = Math.min(100, existing.confidence + confidence);
        existing.reasons.push(reason);
        return;
    }
    signals.push({ name, confidence, reasons: [reason] });
};
export const detectFrameworks = async (root, packageJson) => {
    const signals = [];
    const dependencyChecks = [
        ['Express', ['express'], 70],
        ['Fastify', ['fastify'], 70],
        ['NestJS', ['@nestjs/core', '@nestjs/common'], 80],
        ['Next.js', ['next'], 80],
        ['Remix', ['@remix-run/node', '@remix-run/react', '@remix-run/dev'], 80],
        ['Nuxt/Nitro', ['nuxt', 'nitropack', 'h3'], 75],
        ['SvelteKit', ['@sveltejs/kit'], 80],
        ['Astro', ['astro'], 75],
        ['Hono', ['hono'], 70],
        ['Koa', ['koa'], 70],
        ['Prisma', ['prisma', '@prisma/client'], 65],
        ['Mongoose', ['mongoose'], 60],
        ['tRPC', ['@trpc/server'], 65],
    ];
    for (const [name, dependencies, confidence] of dependencyChecks) {
        if (hasDependency(packageJson, dependencies))
            addSignal(signals, name, confidence, `dependency: ${dependencies.join(' / ')}`);
    }
    const fileSignals = [
        ['Next.js', 'next.config.js', 30],
        ['Next.js', 'next.config.mjs', 30],
        ['NestJS', 'nest-cli.json', 40],
        ['Nuxt/Nitro', 'nuxt.config.ts', 40],
        ['SvelteKit', 'svelte.config.js', 40],
        ['Astro', 'astro.config.mjs', 40],
        ['Remix', 'remix.config.js', 35],
        ['Prisma', 'prisma/schema.prisma', 35],
    ];
    for (const [name, path, confidence] of fileSignals) {
        if (await fileExists(join(root, path)))
            addSignal(signals, name, confidence, `file: ${path}`);
    }
    return signals.sort((left, right) => right.confidence - left.confidence);
};
//# sourceMappingURL=frameworks.js.map
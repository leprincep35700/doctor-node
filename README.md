# Doctor Node

Local-first diagnostics for Node.js projects. Think “React Doctor”, but aimed at the Node ecosystem: Express, Fastify, NestJS, Next.js APIs, Remix, Nuxt/Nitro, SvelteKit, Astro, Hono, Koa, Prisma and generic TypeScript/JavaScript backends.

## Principles

- **Local only**: no telemetry, no remote scoring, no upload.
- **Framework aware**: detects common Node frameworks from dependencies and files.
- **Actionable**: every diagnostic includes severity, category, file when available, rationale and fix suggestion.
- **CI friendly**: text or JSON output, optional minimum score gate.

## Usage

```bash
npx -y https://github.com/leprincep35700/doctor-node/archive/refs/heads/main.tar.gz .
```

Local checkout:

```bash
npm install
npm run build
node dist/cli.js /path/to/project
```

Useful flags:

```bash
doctor-node . --json
doctor-node . --min-score 85
doctor-node . --include-tests --max-files 2000
```

## What it checks

- Project metadata: package manager consistency, Node engine, useful scripts, module type.
- TypeScript: strictness, config hygiene, generated/build folder exclusions.
- Dependency hygiene: obvious unused dependencies, mixed lockfiles, duplicated config signals.
- Security: committed env files, hardcoded secrets, dangerous `eval`/`Function`, risky child-process usage, weak JWT verification, exposed CORS, missing auth hints on API routes.
- Runtime reliability: top-level mutable singletons, `await` inside loops, floating promises, missing process-level shutdown/error hooks.
- Framework-specific checks for Express, Fastify, NestJS, Next.js route handlers, Remix loaders/actions, Nuxt/Nitro handlers, SvelteKit endpoints, Astro endpoints, Hono and Koa.
- Operations: Docker healthcheck, `.dockerignore`, CI workflow, README and environment examples.

## Exit codes

- `0`: scan completed and score is above the configured minimum.
- `1`: scan completed but score is below `--min-score`, or a fatal scan error occurred.

## Status

Private first iteration / MVP. The intent is to grow this into a high-signal local advisor for backend JavaScript and TypeScript codebases.

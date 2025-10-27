# Repository Guidelines

## Project Structure & Module Organization

- `src/app` holds Next.js routes and API handlers; UI primitives live in `src/components`.
- Shared server logic sits in `src/actions`, `src/lib`, and `src/repository`.
- Drizzle migrations and schema snapshots live under `drizzle/` with settings in `drizzle.config.ts`.
- Static assets stay in `public/`; deployment helpers live in `deploy/`, `docker-compose.yaml`, and the `Makefile`.
- Docker volumes write into `data/`; treat it as runtime-only.

## Build, Test, and Development Commands

- `pnpm dev` — starts Next.js (port 13500) with Turbo for local work.
- `pnpm build` / `pnpm start` — compiles the standalone production bundle and serves it.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` — run ESLint 9, TypeScript `--noEmit`, and Prettier verification; treat failures as blockers.
- `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:push`, `pnpm db:studio` — Drizzle Kit for schema evolution.
- `docker compose up -d` — spins up the full stack (app, Postgres, Redis) for parity testing.

## Coding Style & Naming Conventions

- 2-space indentation, trailing commas, and single quotes follow Prettier and `eslint.config.mjs`.
- React components use PascalCase (`UsageChart.tsx`); hooks and utilities stay camelCase; route folders remain kebab-case.
- Prefer `async/await`, keep server actions inside `src/actions`, and co-locate Tailwind classes with the JSX they style.
- Run `pnpm format` before submitting wide-ranging edits.

## Testing Guidelines

- Today we rely on `pnpm lint` and `pnpm typecheck` plus manual checks through `/admin`.
- Smoke API changes with `curl -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:13500/api/providers`.
- New automated tests should follow `*.spec.ts` naming, live next to the feature, and wire into `package.json` scripts.
- Note any seed data or feature flags in the PR description so reviewers can reproduce your scenario.

## Commit & Pull Request Guidelines

- Follow Conventional commits (`fix:`, `chore:`, `feat:`) as seen in `git log`; keep subjects under 72 characters.
- Body text should note user impact plus migration or environment changes.
- PRs must include a short summary, screenshots or JSON samples for UI/API updates, links to issues, and migration callouts.
- Rebase onto `main`, run `pnpm lint && pnpm typecheck`, and flag anything that blocks deploy parity.

## Security & Configuration Tips

- Start from `.env.example`, rotate `ADMIN_TOKEN` before sharing previews, and scope provider keys to least privilege.
- Keep Redis, Postgres, and upstream tokens in secrets management—never in Git commits.
- Prefer `pnpm dev` with mock providers when debugging rather than production credentials.

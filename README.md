# bugdapp

AI-powered Web3 dApp testing platform. Record user interactions with a browser extension, auto-generate Playwright test specs using Claude, and execute them with real MetaMask wallets via [dappwright](https://github.com/nicholasgriffintn/dappwright).

## Architecture

Monorepo with 5 components:

| Component | Path | Description |
|-----------|------|-------------|
| **Extension** | `extension/` | Chrome extension that records user interactions on dApps |
| **Translator** | `packages/translator/` | Claude AI converts recordings into Playwright test specs |
| **API** | `packages/api/` | Fastify backend with BullMQ job queue |
| **Executor** | `packages/executor/` | Docker-based worker that runs tests with real MetaMask (dappwright) |
| **Dashboard** | `packages/dashboard/` | Next.js UI for managing tests and viewing results |

Supporting infrastructure: PostgreSQL, Redis (BullMQ), MinIO (artifact storage).

## Features

- **Recording** -- Browser extension captures clicks, navigation, network requests, and wallet interactions
- **AI Translation** -- Claude converts raw recordings into deterministic Playwright specs
- **Spec Execution** -- Runs generated specs in Docker with a real MetaMask extension via dappwright
- **Agent Mode** -- AI-driven browser automation that adapts to UI changes in real-time
- **Hybrid Mode** -- Spec runs first (fast, free); on failure, agent mode takes over automatically
- **Visual Replay** -- Step-by-step screenshots and traces for debugging

## Prerequisites

- Docker and Docker Compose
- Anthropic API key (for test generation and agent mode)

## Quick Start

```bash
cp .env.example .env
# Edit .env and set your ANTHROPIC_API_KEY

docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) to access the dashboard.

## Services

| Service | Port |
|---------|------|
| Dashboard | 3000 |
| API | 3001 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| MinIO Console | 9001 |

## License

MIT

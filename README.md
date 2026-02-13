# bugdapp

AI-powered Web3 dApp testing platform. Record user interactions with a browser extension, auto-generate Playwright test specs using Claude, and execute them with real MetaMask wallets via [dappwright](https://github.com/nicholasgriffintn/dappwright).

## How It Works

1. **Record** -- Install the Chrome extension, navigate to any dApp, and hit record. The extension captures every click, navigation, form input, and wallet interaction.
2. **Translate** -- Submit the recording through the dashboard. Claude AI analyzes it and generates a deterministic Playwright test spec.
3. **Execute** -- The executor runs your spec inside Docker with a real MetaMask wallet (via dappwright). You get pass/fail results, step-by-step screenshots, and Playwright traces.
4. **Self-heal** -- If a spec fails (e.g. the dApp UI changed), agent mode takes over and uses Claude to drive the browser in real-time, adapting to the new UI.

## Architecture

Monorepo with 5 components:

| Component | Path | Description |
|-----------|------|-------------|
| **Extension** | `extension/` | Chrome extension that records user interactions on dApps |
| **Translator** | `packages/translator/` | Claude AI converts recordings into Playwright test specs |
| **API** | `packages/api/` | Fastify backend with BullMQ job queue |
| **Executor** | `packages/executor/` | Docker-based worker that runs tests with real MetaMask (dappwright) |
| **Dashboard** | `packages/dashboard/` | Next.js UI for managing tests and viewing results |

Supporting infrastructure: PostgreSQL, Redis (BullMQ), MinIO (S3-compatible artifact storage).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (included with Docker Desktop)
- An [Anthropic API key](https://console.anthropic.com/) (for test generation and agent mode)
- Google Chrome (for the recorder extension)

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/sidNarasimhan/bugdapp.git
cd bugdapp
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...your-key-here
```

All other defaults (Postgres password, MinIO credentials, etc.) work out of the box for local development.

### 3. Start all services

```bash
docker compose up -d
```

This builds and starts everything: PostgreSQL, Redis, MinIO, the API, the dashboard, and the executor. First run takes a few minutes to build the Docker images.

Check that all services are healthy:

```bash
docker compose ps
```

You should see all containers running. The `db-migrate` and `minio-init` containers will show as exited (they run once and stop -- that's normal).

### 4. Open the dashboard

Go to [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Install the Chrome extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `extension/dist` folder from this repo

You should see the "Web3 Test Recorder" extension icon in your toolbar.

### 6. Record a test

1. Navigate to any dApp (e.g. Uniswap, Aave, etc.)
2. Click the bugdapp extension icon and hit **Start Recording**
3. Interact with the dApp -- connect your wallet, switch networks, click buttons, fill forms
4. Click **Stop Recording** when done
5. The extension saves a JSON recording. Upload it through the dashboard to generate a test spec.

### 7. Run a test

From the dashboard, select a test and click **Run**. The executor will:
- Spin up a headless Chrome with MetaMask pre-installed
- Execute the Playwright spec against the real dApp
- Return results with screenshots and a Playwright trace

## Execution Modes

| Mode | Description | Cost |
|------|-------------|------|
| **Spec** | Runs the generated Playwright spec as-is. Fast and free. | $0 |
| **Agent** | Claude drives the browser in real-time, making decisions at each step. | ~$0.27/run |
| **Hybrid** | Spec runs first. If it fails, agent mode takes over automatically. | ~$0.02/run |

## Services & Ports

| Service | Port | URL |
|---------|------|-----|
| Dashboard | 3000 | http://localhost:3000 |
| API | 3001 | http://localhost:3001 |
| PostgreSQL | 5432 | -- |
| Redis | 6379 | -- |
| MinIO API | 9000 | -- |
| MinIO Console | 9001 | http://localhost:9001 |
| VNC (executor) | 5900 | -- |
| noVNC (executor) | 6080 | http://localhost:6080 |

**VNC**: You can watch test execution live by connecting a VNC client to `localhost:5900` (password: `secret`) or opening `http://localhost:6080` in your browser.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | -- | **Required.** Your Anthropic API key for Claude. |
| `POSTGRES_PASSWORD` | `web3testpass` | PostgreSQL password |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin123` | MinIO secret key |
| `WORKER_CONCURRENCY` | `1` | Number of parallel test executions |
| `VNC_PASSWORD` | `secret` | Password for VNC viewer |
| `SEED_PHRASE` | `test test...junk` | MetaMask wallet seed phrase (use a test wallet) |
| `SELF_HEAL_MODEL` | `claude-sonnet-4-5-20250929` | Claude model for spec regeneration |
| `AGENT_MODEL` | `claude-sonnet-4-5-20250929` | Claude model for agent mode |
| `LOG_LEVEL` | `info` | API log level (`debug`, `info`, `warn`, `error`) |

## Stopping & Cleanup

```bash
# Stop all services
docker compose down

# Stop and remove all data (database, artifacts, etc.)
docker compose down -v
```

## License

MIT

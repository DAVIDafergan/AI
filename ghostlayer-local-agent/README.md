# 👻 GhostLayer On-Premise Agent

A privacy-first, **context-aware AI agent** that scans your local documents, learns your company's data context using a 100% local NLP model, and reports **only metadata counts** to the GhostLayer SaaS dashboard.

**Zero sensitive data ever leaves your server.**

---

## Quick Start (One-Line Onboarding)

Copy the command below from your GhostLayer dashboard and paste it into a terminal on your server:

```bash
node index.js --api-key=YOUR_TENANT_KEY --dir=/path/to/company/docs
```

That's it. Go grab a coffee – the agent will:
1. Recursively scan all `.txt`, `.md`, `.csv`, and `.json` files
2. **Learn your corpus**: run local Named Entity Recognition (NER) to discover people, organisations, and sensitive terms in your documents
3. **Score every file 0–100**: contextual sensitivity score based on PII, learned entities, and financial keywords
4. Save the annotated brain to `.ghostlayer_brain.json` *(local only)*
5. Send only the **metadata counts** (highly sensitive file count, average score, etc.) to your dashboard

---

## Installation

```bash
cd ghostlayer-local-agent
npm install
```

Requires **Node.js ≥ 18**.

> **First run note:** On the first run the agent downloads the NER model (~16 MB, `Xenova/bert-base-NER`) from HuggingFace and caches it locally. All subsequent runs are fully **offline** – no model data is ever re-fetched. Set `TRANSFORMERS_OFFLINE=1` after the initial download to enforce air-gapped mode.

---

## Usage

```
node index.js [options]

Options:
  --api-key <key>     Tenant API key from the GhostLayer dashboard  (required)
  --dir <path>        Directory to scan (default: current directory)
  --saas-url <url>    Override the SaaS base URL
  --verbose           Print detailed progress
  --dry-run           Run scan + NLP but skip the cloud sync step
  -V, --version       Output the version number
  -h, --help          Display help
```

### Examples

```bash
# Scan /var/company-docs with verbose output
node index.js --api-key=sk-abc123 --dir=/var/company-docs --verbose

# Test locally without sending data to the cloud
node index.js --api-key=sk-abc123 --dir=./sample-docs --dry-run

# Point to a self-hosted GhostLayer instance
node index.js --api-key=sk-abc123 --dir=/data/docs --saas-url=https://my-ghostlayer.example.com
```

---

## Architecture

```
ghostlayer-local-agent/
├── index.js          # CLI entry point – 4-step orchestrator
├── scanner.js        # Recursive directory crawler (.txt .md .csv .json)
├── nlp-engine.js     # Local AI NLP: Transformers.js NER + regex + sensitivity scoring
├── cloud-sync.js     # Sends AI metadata report to SaaS (no content!)
└── package.json
```

### How the AI Pipeline Works

```
Local Documents
      │
      ▼
 Step 1: Scan ──► collect all supported files
      │
      ▼
 Step 2: Learning/Indexing Phase
      │   Run NER (Xenova/bert-base-NER) on the full corpus
      │   Extract: PERSON and ORG entities
      │   Build: company vocabulary ("brain")
      │
      ▼
 Step 3: AI-Powered Sensitivity Scoring (per file)
      │   NER entities × learned-brain match → contextual score
      │   Regex PII (email, phone, credit card, ID) → strong signal
      │   Financial/legal keyword hits → additional signal
      │   Output: sensitivity score 0–100 + classification
      │
      ▼
 Step 4: Cloud Sync ──► metadata counts only (NO content)
```

### Sensitivity Score (0–100)

| Factor | Max contribution |
|--------|-----------------|
| PII matches (email, phone, card, ID) | 40 pts |
| Known company entities in document | 35 pts |
| Any NER person/org entities | 15 pts |
| Financial/legal keyword hits | 10 pts |

| Score | Classification |
|-------|---------------|
| ≥ 70  | 🔴 Highly Sensitive |
| ≥ 35  | 🟡 Sensitive |
| < 35  | ✅ Normal |

### What is detected?

| Type | Examples |
|------|---------|
| PII – Email | `john@company.com` |
| PII – Phone | `+1-800-555-1234` |
| PII – Credit card | `4111 1111 1111 1111` |
| PII – Israeli ID | 9-digit numeric patterns |
| NER – Person | Names detected by local AI model |
| NER – Organisation | Company/org names detected by local AI |
| Financial terms | `confidential`, `payroll`, `budget`, `nda`, `salary` |

### What is **NOT** sent to the cloud?

- File contents
- Actual email addresses, phone numbers, or card numbers found
- Entity names (person names, organisation names)
- The `.ghostlayer_brain.json` file

Only these **metadata counts** are sent in the heartbeat:

```json
{
  "status": "Active",
  "filesScanned": 142,
  "sensitiveTermsFound": 12,
  "highlySensitiveFiles": 3,
  "sensitiveFiles": 8,
  "averageSensitivityScore": 47,
  "entitiesFound": { "persons": 25, "orgs": 10 },
  "agentVersion": "2.0.0",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Local Brain File

After a successful run, the agent saves the full AI brain to:

```
.ghostlayer_brain.json
```

This file contains:
- `learnedIndex`: all PERSON/ORG entities extracted from your corpus and sensitive-term frequencies
- `scanResults`: per-file sensitivity scores and classifications

The brain **stays on your machine** and is never uploaded. You can inspect it at any time to review what was found.

---

## DLP Privacy Guarantee

- **No external API calls** – the NER model (`Xenova/bert-base-NER`) runs entirely via ONNX Runtime in Node.js
- **No content transmission** – only integer counts reach the cloud
- **Air-gapped support** – set `TRANSFORMERS_OFFLINE=1` after initial model download

---

## Local Testing with Mock Server

A built-in mock server simulates the entire GhostLayer SaaS backend so you can
test the agent locally without a real cloud account.

### Start the mock server

```bash
node mock-server.js
# or
npm run mock-server
```

The mock server starts on **port 3333** by default.  Pass `--port <n>` to
change it and `--verbose` for extra logging.

### Connect the agent to the mock server

```bash
node index.js --api-key=test-key --dir=./sample-docs \
              --saas-url=http://localhost:3333 --verbose
```

Or with the local API server:

```bash
SERVER_URL=http://localhost:3333 API_KEY=test-key LOCAL_PORT=4000 node api-server.js
```

### Mock server endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/heartbeat` | Logs heartbeat telemetry |
| `POST` | `/api/tenant-events` | Logs DLP block events |
| `POST` | `/api/reports/scan` | Logs scan summary reports |
| `GET`  | `/api/agents/command-channel` | SSE stream for remote commands |
| `POST` | `/api/agents/command-result` | Logs command execution results |
| `POST` | `/api/agents/send-command` | **Test helper** – push a command to a connected agent |
| `GET`  | `/status` | Show connected agents and uptime |

### Send a remote command to the agent

```bash
# Trigger a scan on all connected agents
curl -X POST http://localhost:3333/api/agents/send-command \
     -H "Content-Type: application/json" \
     -d '{"action":"scan"}'

# Trigger on a specific agent
curl -X POST http://localhost:3333/api/agents/send-command \
     -H "Content-Type: application/json" \
     -d '{"agentId":"mock-agent-1","action":"get-logs"}'
```

---

## Server-Side Endpoint

The agent POSTs to:

```
POST /api/agents/heartbeat
Headers: x-api-key: YOUR_TENANT_KEY
```

The server endpoint is located at `dlp-server/app/api/agents/heartbeat/route.js`.

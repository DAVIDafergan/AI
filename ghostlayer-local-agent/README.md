# 👻 GhostLayer On-Premise Agent

A lightweight, privacy-first CLI tool that scans your local documents, builds a sensitive-terms map entirely on your machine, and reports **only metadata counts** to the GhostLayer SaaS dashboard.

**Zero sensitive data ever leaves your server.**

---

## Quick Start (One-Line Onboarding)

Copy the command below from your GhostLayer dashboard and paste it into a terminal on your server:

```bash
node index.js --api-key=YOUR_TENANT_KEY --dir=/path/to/company/docs
```

That's it. Go grab a coffee – the agent will:
1. Recursively scan all `.txt`, `.md`, `.csv`, and `.json` files
2. Run local NLP to detect PII and sensitive business terms
3. Save the annotated map to `.ghostlayer_brain.json` *(local only)*
4. Send a heartbeat with **only the file/term counts** to your dashboard

---

## Installation

```bash
cd ghostlayer-local-agent
npm install
```

Requires **Node.js ≥ 18**.

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
├── index.js          # CLI entry point (Commander.js)
├── scanner.js        # Recursive directory crawler (.txt .md .csv .json)
├── nlp-engine.js     # Local NLP: regex PII + business-term extraction
├── cloud-sync.js     # Sends metadata heartbeat to SaaS (no content!)
└── package.json
```

### What is scanned?

| Type | Examples |
|------|---------|
| PII – Email | `john@company.com` |
| PII – Phone | `+1-800-555-1234` |
| PII – Credit card | `4111 1111 1111 1111` |
| PII – Israeli ID | 9-digit numeric patterns |
| Project names | `PROJECT ALPHA`, `OPERATION BLUEBIRD` |
| Financial terms | `confidential`, `payroll`, `budget`, `nda` |
| Top proper nouns | High-frequency capitalised words across documents |

### What is **NOT** sent to the cloud?

- File contents
- Actual email addresses, phone numbers, or card numbers found
- The `.ghostlayer_brain.json` file

Only these fields are sent in the heartbeat:

```json
{
  "status": "Active",
  "filesScanned": 142,
  "sensitiveTermsFound": 37,
  "agentVersion": "1.0.0",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Local Brain File

After a successful run, the agent saves a detailed sensitive-terms map to:

```
.ghostlayer_brain.json
```

This file contains the full NLP results and **stays on your machine**. You can inspect it at any time to review what was found.

---

## Server-Side Endpoint

The agent POSTs to:

```
POST /api/agents/heartbeat
Headers: x-api-key: YOUR_TENANT_KEY
```

The server endpoint is located at `dlp-server/app/api/agents/heartbeat/route.js`.

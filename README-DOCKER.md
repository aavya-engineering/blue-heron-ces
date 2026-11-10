# CES (Compliance Engine System) - Docker & Deployment Guide

This guide describes how to build, run, and deploy the CES application in Docker with an **Nginx Reverse Proxy**, allowing all CES services to be accessible from a **single domain or IP address** on standard HTTP/HTTPS ports (80/443).

---

## 1. Single Domain Architecture Overview

With Nginx in front of the CES application container, you only need **one domain or IP address** (e.g., `http://136.108.118.191` or `http://your-domain.com`).

```
                ┌──────────────────────────────────────┐
                │   User Browser / Public Traffic      │
                │        http://136.108.118.191        │
                └──────────────────┬───────────────────┘
                                   │ Port 80 / 443
                                   ▼
             ┌──────────────────────────────────────────────┐
             │            ces-nginx (Port 80/443)           │
             │       Unified Portal & Reverse Proxy         │
             └──────┬──────────┬──────────┬──────────┬──────┘
                    │          │          │          │
   ┌────────────────┼──────────┼──────────┼──────────┼────────────────┐
   │                ▼          ▼          ▼          ▼                │
   │            /muster/    /stamper/    /ao/       /eo/              │
   │               │          │          │          │                 │
   │  ces-app      ▼          ▼          ▼          ▼                 │
   │  Container: Port 5173  Port 5002  Port 5003  Port 5004           │
   │            (Muster)   (Stamper)  (AdminOps) (EvidenceOps)        │
   │                                                                  │
   │            Port 4000  Port 4001  Port 4390                       │
   │            (MusterAPI)(EC Upload)(Stacksim Simulator)            │
   │                     \      │      /                              │
   │                      \     │     /                               │
   │                   Unified SQLite (ces.db)                        │
   └──────────────────────────────────────────────────────────────────┘
```

---

## 2. Accessing Services via Single Domain (`136.108.118.191.sslip.io`)

Because `sslip.io` automatically resolves any subdomain to the IP address, **no manual DNS records are needed!** You can access the entire stack immediately via HTTP or HTTPS using `https://136.108.118.191.sslip.io/`:

### Option A: Subdomain Routing (`https://service.136.108.118.191.sslip.io/`) — Recommended
Subdomain routing gives each web app and API its own clean root URL without path collisions:

| Service | Subdomain URL (HTTPS) | Upstream Port | Description |
|---|---|---|---|
| **CES Unified Portal** | `https://136.108.118.191.sslip.io/` | `:80 / :443` | Interactive portal dashboard with live service routing |
| **Muster Web UI** | `https://muster.136.108.118.191.sslip.io/` | `:5173` | CMMC readiness assessment & questionnaire |
| **Stamper GUI & Engine** | `https://stamper.136.108.118.191.sslip.io/` | `:5002` | M365 GCC High configuration stamper |
| **AdminOps GUI** | `https://ao.136.108.118.191.sslip.io/` | `:5003` | 85+ governed admin operations (joiners/leavers) |
| **EvidenceOps Console** | `https://eo.136.108.118.191.sslip.io/` | `:5004` | Continuous evidence collection, SPRS score & SSP `.docx` |
| **Tenant Simulator** | `https://sim.136.108.118.191.sslip.io/` | `:4390` | Mock GCC High tenant ledger inspector |
| **Evidence Collector** | `https://ec.136.108.118.191.sslip.io/` | `:4001` | Evidence intake ledger API |
| **Muster REST API** | `https://api.136.108.118.191.sslip.io/` | `:4000` | Scoping & plan compilation REST API |

---

### Option B: Subpath Routing (`https://136.108.118.191.sslip.io/service/`)
All services are also simultaneously accessible via subpaths on the root domain:

| Service | Subpath URL | Upstream Port |
|---|---|---|
| **CES Unified Portal** | `https://136.108.118.191.sslip.io/` | `:80 / :443` |
| **Muster Web UI** | `https://136.108.118.191.sslip.io/muster/` | `:5173` |
| **Stamper GUI & Engine**| `https://136.108.118.191.sslip.io/stamper/` | `:5002` |
| **AdminOps GUI** | `https://136.108.118.191.sslip.io/ao/` | `:5003` |
| **EvidenceOps Console** | `https://136.108.118.191.sslip.io/eo/` | `:5004` |
| **Tenant Simulator** | `https://136.108.118.191.sslip.io/stacksim/` | `:4390` |
| **Evidence Collector** | `https://136.108.118.191.sslip.io/ec/api/health` | `:4001` |
| **Muster API** | `https://136.108.118.191.sslip.io/muster-api/` | `:4000` |

---

### Enabling Free SSL/HTTPS (Certbot / Let's Encrypt)

Nginx is already configured with ACME challenge passthrough (`/.well-known/acme-challenge/`).

To generate a free SSL certificate on the remote server:
```bash
docker run -it --rm \
  -v ces_certbot_conf:/etc/letsencrypt \
  -v ces_certbot_www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d yourdomain.com -d *.yourdomain.com
```

Once certificates are issued:
1. Copy `nginx/conf.d/ssl.conf.template` to `nginx/conf.d/ssl.conf`.
2. Replace `yourdomain.com` with your domain.
3. Reload Nginx: `docker compose exec nginx nginx -s reload`.

---

## 3. Remote Server Deployment

### Target Server Details
- **Host**: `136.108.118.191`
- **User**: `neele`
- **Directory**: `/home/neele/project/CES`
- **SSH Key**: `id_ed25519`

### Option A: One-Command Deployment (from Local Machine)

#### From Windows (PowerShell):
```powershell
.\deploy.ps1 -KeyPath "path\to\id_ed25519"
```

#### From Linux / macOS / Git Bash:
```bash
chmod +x deploy.sh
./deploy.sh path/to/id_ed25519
```

The script will automatically upload all files (including the Nginx proxy configuration), build the Docker images, and start the containers.

---

### Option B: Manual Commands on the Remote Server

1. SSH into the server:
   ```bash
   ssh -i id_ed25519 neele@136.108.118.191
   ```

2. Go to the project directory:
   ```bash
   cd ~/project/CES
   ```

3. Launch with Docker Compose:
   ```bash
   docker compose down --remove-orphans || true
   docker compose build
   docker compose up -d
   ```

4. Verify running containers:
   ```bash
   docker compose ps
   ```
   You will see both `ces-app` and `ces-nginx` running!

5. Open `http://136.108.118.191` in your browser to access the unified portal.

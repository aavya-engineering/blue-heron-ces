# CES — Full Setup & Verify Guide

Everything runs from **`C:\ces-nb`** — that is the one correct location.

The project documentation (`START-HERE.md`) requires this exact path because
some internal scripts and test files hard-code `C:\ces-nb`. Do not run Docker
or any CES commands from any other folder.

```
C:\ces-nb\        ← all Docker commands run from here
```

The git repository (`heron_ces\heron_ces`) is a separate clone used for
version control and development. The operational setup lives in `C:\ces-nb`.

---

## Prerequisites

| Tool | Minimum version | Check |
|---|---|---|
| Docker Desktop | 4.x | `docker --version` |
| Node.js | 24.x | `node --version` |
| Git | any | `git --version` |

Docker Desktop must be **running** before any docker command.
Node.js is only needed if you run the Demo Commander locally (outside Docker).

---

## First-Time Setup

### 1. Open a terminal in `C:\ces-nb`

```powershell
cd C:\ces-nb
```

All commands in this guide run from this folder.

### 2. Create your `.env` file

```powershell
Copy-Item .env.example .env
```

Open `.env` and fill in three values:

```env
# Generate secrets with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

JWT_SECRET=<paste 64-char hex here>
CES_EO_OPERATOR_SECRET=<paste 64-char hex here>
ANTHROPIC_API_KEY=sk-ant-...        # your Anthropic key; leave placeholder if not needed
```

> `.env` is gitignored — it will never be committed.

### 3. Build the Docker image

```powershell
docker compose build
```

**This takes 10–20 minutes on the first run.** It:
- Pulls the Node 24 Linux base image
- Installs system packages (supervisor, sqlite3, PowerShell 7)
- Runs `npm install` for all 7 modules
- Compiles all TypeScript
- Installs Playwright Chromium (for the Demo Commander)

Subsequent builds are fast because Docker caches each layer.

---

## Start the Application

```powershell
docker compose up -d
```

This starts two containers:

| Container | What it does |
|---|---|
| `ces-app` | All 7 CES modules + Demo Commander, managed by supervisord |
| `ces-nginx` | Reverse proxy on ports 80 and 443; waits for `ces-app` to be healthy |

The SQLite database (`ces.db`) is created automatically inside the `ces_data`
Docker volume on first start. No separate database container is needed.

---

## Verify Everything Is Running

### Step 1 — Check all 8 services

```powershell
docker exec ces-app supervisorctl status
```

Expected output — all must show `RUNNING`:

```
ao               RUNNING   pid ..., uptime ...
demo-commander   RUNNING   pid ..., uptime ...
ec               RUNNING   pid ..., uptime ...
eo               RUNNING   pid ..., uptime ...
muster-api       RUNNING   pid ..., uptime ...
muster-ui        RUNNING   pid ..., uptime ...
stacksim         RUNNING   pid ..., uptime ...
stamper          RUNNING   pid ..., uptime ...
```

If any show `BACKOFF` or `FATAL`, see the Troubleshooting section below.

### Step 2 — Check container health

```powershell
docker compose ps
```

Expected:

```
NAME        STATUS
ces-app     Up X minutes (healthy)
ces-nginx   Up X minutes
```

### Step 3 — Test muster-api login

```powershell
docker exec ces-app node -e "
const http = require('http');
const body = JSON.stringify({email:'demo@ces-demo.local',password:'CesDemo2026!'});
const req = http.request(
  {host:'127.0.0.1',port:4000,path:'/auth/login',method:'POST',
   headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
  r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log('HTTP',r.statusCode, d.substring(0,80))); }
);
req.write(body); req.end();"
```

Expected: `HTTP 200 {"token":"eyJ...`

### Step 4 — Open in browser

| Module | URL |
|---|---|
| **Demo Commander** | `https://localhost/demo/` |
| Muster UI | `https://localhost/muster/` |
| Stamper | `https://localhost/stamper/` |
| AdminOps | `https://localhost/ao/` |
| EvidenceOps | `https://localhost/eo/` |
| Stacksim | `https://localhost/stacksim/` |

> **Browser warning:** Click **Advanced → Proceed to localhost**.
> This is expected — the SSL certificate is self-signed for local use.

**Demo login credentials:**
- Email: `demo@ces-demo.local`
- Password: `CesDemo2026!`

---

## Database

CES uses **SQLite** via `better-sqlite3`. It is embedded inside the app — no
separate database container is needed.

| Item | Value |
|---|---|
| File path (inside container) | `/app/data/ces.db` |
| Docker volume | `heron_ces_ces_data` |
| Auto-created | Yes, on first start |

### Inspect the database

```powershell
# Open an interactive SQLite shell
docker exec -it ces-app sqlite3 /app/data/ces.db

# Useful commands inside sqlite3:
.tables                        -- list all tables
.schema user                   -- show user table schema
SELECT * FROM user LIMIT 5;   -- see users
SELECT * FROM tenant;          -- see tenants
.quit
```

### Backup the database

```powershell
docker exec ces-app sqlite3 /app/data/ces.db ".dump" > backup.sql
```

### Restore from backup

```powershell
docker exec -i ces-app sqlite3 /app/data/ces.db < backup.sql
```

---

## Day-to-Day Commands

All commands run from `C:\ces-nb`:

```powershell
cd C:\ces-nb

# Start (after first build)
docker compose up -d

# Stop  (data is preserved in volumes)
docker compose down

# Restart one service without rebuilding
docker exec ces-app supervisorctl restart muster-api

# Restart all services inside the container
docker exec ces-app supervisorctl restart all

# View live logs for any service
docker exec ces-app tail -f /var/log/supervisor/muster-api.out.log
docker exec ces-app tail -f /var/log/supervisor/demo.out.log
docker exec ces-app tail -f /var/log/supervisor/eo.out.log

# All logs at once
docker compose logs -f

# Rebuild after code changes
docker compose build
docker compose up -d

# Full reset — WARNING: deletes the SQLite database
docker compose down -v
docker compose up -d
```

---

## Troubleshooting

### A service shows BACKOFF or FATAL

```powershell
# Check its error log
docker exec ces-app cat /var/log/supervisor/<service>.err.log
docker exec ces-app cat /var/log/supervisor/<service>.out.log

# Service names: ao, ec, eo, muster-api, muster-ui, stacksim, stamper, demo-commander
```

### demo-commander is in BACKOFF on first start

This is normal for the first ~2 minutes. The demo-commander waits for all 6
other modules to be ready before starting. Run the status check again after 2 minutes.

### Container exits immediately with JWT_SECRET error

Your `.env` file has the placeholder value. Open `.env` and replace
`JWT_SECRET=change_me_min_32_chars` with a real 64-char hex string:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Port 80 or 443 already in use

Another app is using that port. Find and stop it:

```powershell
netstat -ano | findstr ":80 "
netstat -ano | findstr ":443 "
# Then: Stop-Process -Id <PID> -Force
```

### Browser shows "connection refused" on https://localhost

Check nginx is running:

```powershell
docker compose ps
# If ces-nginx is not Up, check: docker compose logs nginx
```

### Containers keep restarting

```powershell
docker compose logs ces
# Look for the first error message near the top
```

---

## File Map

```
heron_ces\heron_ces\
│
├── Dockerfile               ← image build instructions
├── docker-compose.yml       ← defines ces-app and ces-nginx containers
├── .env                     ← your secrets (gitignored — never commit this)
├── .env.example             ← template showing what .env needs
│
├── docker\
│   ├── entrypoint.sh        ← runs on container start; validates secrets, starts supervisord
│   ├── supervisord.conf     ← manages all 8 services inside the container
│   └── start-walkthrough.sh ← waits for modules, seeds demo user, starts Demo Commander
│
├── nginx\
│   ├── nginx.conf           ← main nginx config (WebSocket upgrades, API routing map)
│   ├── conf.d\default.conf  ← proxy rules for every /path/ → internal port
│   └── certs\
│       ├── cert.pem         ← self-signed SSL certificate
│       └── key.pem          ← private key
│
└── ces\                     ← all 7 application modules (source code)
    ├── ces-muster\          ← Muster UI + API (port 5173, 4000)
    ├── ces-stamper\         ← Stamper (port 5002)
    ├── ces-ao\              ← AdminOps (port 5003)
    ├── ces-eo\              ← EvidenceOps (port 5004)
    ├── ces-ec\              ← Evidence Collector (port 4001)
    ├── tenant-stacksim\     ← Tenant Simulator (port 4390)
    └── ces-tester\          ← Test runner + Playwright (Demo Commander)
```

---

## Internal Port Reference

| Module | Internal port | Nginx path |
|---|---|---|
| Muster UI | 5173 | `/muster/` |
| Muster API | 4000 | `/muster-api/` |
| Stamper | 5002 | `/stamper/` |
| AdminOps | 5003 | `/ao/` |
| EvidenceOps | 5004 | `/eo/` |
| Evidence Collector | 4001 | `/ec/` |
| Stacksim | 4390 | `/stacksim/` |
| Demo Commander | 4600 | `/demo/` |

All traffic enters through nginx on port 443 (HTTPS). Internal ports are not
exposed to your host machine.

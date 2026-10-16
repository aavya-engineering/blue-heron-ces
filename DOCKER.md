# Blue Heron CES — Docker Deployment Guide

Deploy the complete Blue Heron Compliance Engine System (CES) anywhere: on local development machines, private data centers, or any major cloud platform (AWS, Azure, GCP, DigitalOcean, Kubernetes).

---

## 🚀 Quick Start (1-Command Launch)

### Prerequisites
- [Docker Engine](https://docs.docker.com/engine/install/) & [Docker Compose v2+](https://docs.docker.com/compose/) (or Docker Desktop on Windows/macOS)

### Launch the Stack

**On Windows (PowerShell):**
```powershell
pwsh docker-start.ps1
```

**On Linux / macOS:**
```bash
chmod +x docker-start.sh
./docker-start.sh
```

**Or using Docker Compose directly:**
```bash
docker compose up --build -d
```

---

## 🌐 Service Matrix & Endpoints

Once running, the following endpoints are available:

| Service | Container | Host Port | Internal Port | Description & URL |
| :--- | :--- | :--- | :--- | :--- |
| **Muster Web (HTTPS / SSL)** | `muster-ui` | `443` | `443` | **Secure Web Portal:** [https://127.0.0.1.sslip.io](https://127.0.0.1.sslip.io) |
| **Muster Web (HTTP)** | `muster-ui` | `5173` & `8080` | `80` | Frontend SPA: [http://localhost:5173](http://localhost:5173) or [http://localhost:8080](http://localhost:8080) |
| **Muster Backend API** | `muster-api` | `4000` | `4000` | REST API: [http://localhost:4000](http://localhost:4000) (Health: `/auth/me`) |
| **Tenant Auth Daemon** | `ces-tenant` | `4690` | `4690` | Auth & session daemon: [http://localhost:4690/status](http://localhost:4690/status) |
| **Mock GCC High Cloud** | `ces-stacksim`| `4390` | `4390` | Microsoft 365 / Azure GCC High simulator: [http://localhost:4390](http://localhost:4390) |
| **PostgreSQL Database** | `muster-postgres`| `5434` | `5432` | Postgres 16 DB: `muster_db` (user: `muster_app`) |
| **Stamper GUI** *(Optional)* | `ces-stamper` | `5002` | `5002` | Remediation UI: [http://localhost:5002](http://localhost:5002) *(run with `--profile full`)* |

> [!TIP]
> **sslip.io & SSL Out of the Box:**
> - When accessed at `https://127.0.0.1.sslip.io`, Nginx serves the application over TLS/SSL using automatically generated SAN certificates matching `*.sslip.io`, `127.0.0.1.sslip.io`, and `localhost`.
> - If deployed on a cloud server or VM with public/LAN IP (e.g. `54.21.32.11` or `192.168.1.100`), simply open `https://<your-ip>.sslip.io`!
> - The container automatically reverse-proxies `/api/` and `/auth/` routes internally over HTTPS without mixed-content or CORS issues.

---

## 🔒 SSL & sslip.io Configuration

### 1. Automatic Zero-Config SSL (Default)
On startup, `docker/nginx-entrypoint.sh` automatically provisions a 2048-bit RSA TLS certificate with SAN entries for your sslip.io domain.
Just open `https://127.0.0.1.sslip.io` (or your IP domain) in your browser. On first visit, your browser will prompt to trust the self-signed developer certificate.

### 2. Custom Domain or Server IP
In `.env`:
```bash
# Example for a cloud server with IP 54.21.32.11:
SSLIP_DOMAIN=54.21.32.11.sslip.io
HOST_IP=54.21.32.11
```
Then restart the UI:
```bash
docker compose up -d --force-recreate muster-ui
```

### 3. Production Let's Encrypt / CA Certificates
To use verified Let's Encrypt or corporate CA certificates, mount them into the container:
```bash
# In docker-compose.yml or as a volume bind:
volumes:
  - /path/to/fullchain.pem:/etc/nginx/ssl/cert.pem:ro
  - /path/to/privkey.pem:/etc/nginx/ssl/key.pem:ro
```
When existing files are detected in `/etc/nginx/ssl/`, Nginx automatically loads your CA certificates.

---

## ⚙️ Configuration (.env)

All configuration options are defined in [`.env`](file:///c:/Users/neele/OneDrive/Documents/aavya\heron_ces/.env) (copied from [`.env.example`](file:///c:/Users/neele/OneDrive/Documents/aavya\heron_ces/.env.example)):

```bash
# Ports
HTTPS_PORT=443
UI_PORT=5173
HTTP_PORT=8080
API_PORT=4000
POSTGRES_PORT=5434
TENANT_PORT=4690
STACKSIM_PORT=4390

# sslip.io & SSL
SSLIP_DOMAIN=127.0.0.1.sslip.io

# Security (Change in production!)
JWT_SECRET=your-32-char-secure-random-string
JWT_EXPIRES_IN=8h
POSTGRES_PASSWORD=your-secure-postgres-password
DB_PASSWORD=your-secure-app-password

# AI Capabilities (Optional - enables adaptive interview & AI coach)
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

---

## ☁️ Deploying to Production Cloud Platforms

### 1. Any Linux Server / VPS (AWS EC2, Azure VM, DigitalOcean Droplet, Linode)
1. Clone the repository onto the server.
2. Edit `.env` with your domain and production passwords.
3. Run:
   ```bash
   docker compose up --build -d
   ```
4. Configure your firewall / security group to allow inbound traffic on port 80/443 (or put behind an HTTPS reverse proxy like Cloudflare, Traefik, or Caddy).

### 2. AWS (ECS / Fargate or App Runner)
- Build and push the images (`muster-ui`, `muster-api`, `ces-tenant`, `ces-stacksim`) to **AWS ECR**:
  ```bash
  docker build -f docker/Dockerfile.ui -t <aws-account-id>.dkr.ecr.<region>.amazonaws.com/muster-ui:latest .
  docker build -f docker/Dockerfile.api -t <aws-account-id>.dkr.ecr.<region>.amazonaws.com/muster-api:latest .
  docker push <aws-account-id>.dkr.ecr.<region>.amazonaws.com/muster-ui:latest
  docker push <aws-account-id>.dkr.ecr.<region>.amazonaws.com/muster-api:latest
  ```
- Use **AWS RDS PostgreSQL** for the database (`DATABASE_URL=postgresql://muster_app:<pass>@<rds-endpoint>:5432/muster_db`).
- Deploy tasks using ECS task definitions with container dependencies matching `docker-compose.yml`.

### 3. Azure (Azure Container Apps / App Service)
- Use **Azure Database for PostgreSQL Flexible Server**.
- Push images to **Azure Container Registry (ACR)**.
- Deploy an **Azure Container Apps Environment** with the services connected via the internal service bus.

### 4. Kubernetes (EKS, AKS, GKE, K3s)
- All services have standard HTTP `/health` or readiness probes configured in Dockerfiles.
- Persistent volumes are declared for PostgreSQL and pipeline artifacts (`muster_postgres_data`, `ces_pipeline_data`).
- Environment variables map directly to Kubernetes `ConfigMap` and `Secret` resources.

---

## 🛠️ Management & Troubleshooting

### View Container Logs
```bash
# Tail logs across all services
docker compose logs -f

# Tail specific service logs
docker compose logs -f muster-api
docker compose logs -f muster-ui
docker compose logs -f postgres
```

### Run Migrations & Prisma Commands
Prisma migrations run automatically on startup via `docker/api-entrypoint.sh`. If you ever need to run Prisma manually:
```bash
docker compose exec muster-api npx prisma migrate status
docker compose exec muster-api npx prisma db seed
```

### Database Backup & Restore
```bash
# Backup database to host
docker exec -t muster-postgres pg_dump -U postgres muster_db > backup_$(date +%Y%m%d).sql

# Restore database from host
cat backup.sql | docker exec -i muster-postgres psql -U postgres muster_db
```

### Stop the Stack
```powershell
pwsh docker-stop.ps1
# or
docker compose down
```

### Full Reset (Wipe Database Volume)
```bash
docker compose down -v
```

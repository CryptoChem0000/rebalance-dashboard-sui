# TLDR

## Using Docker Compose

Create a `.env` file in the project folder:
```bash
# Required
MNEMONIC="your twelve or twenty four word secret phrase"

# Optional - defaults shown
WATCH_FREQUENCY=300                           # Check interval in seconds
OSMOSIS_POOL_ID=1282                          # Pool ID from app.osmosis.zone/pools
REBALANCE_THRESHOLD_PERCENT=95                # Rebalance at 95% out of range
OSMOSIS_POSITION_BAND_PERCENTAGE=1            # ±1% from current price
CONFIG_FILE=./docker-files/config/config.json # Config file to read and write from (relative to project's root path)
```

Then run:

```bash
docker compose build
docker compose up -d
```

## Using plain Docker

```bash
docker build -t lp-rebalancer .

docker run -d \
  --name lp-rebalancer \
  -e MNEMONIC="your mnemonic phrase" \
  -e WATCH_FREQUENCY=300 \
  -e OSMOSIS_POOL_ID=1282 \
  -e REBALANCE_THRESHOLD_PERCENT=95 \
  -e OSMOSIS_POSITION_BAND_PERCENTAGE=1 \
  -v $(pwd)/docker-files/logs:/app/logs \
  -v $(pwd)/docker-files/database:/app/database \
  -v $(pwd)/docker-files/reports:/app/reports \
  -v $(pwd)/docker-files/config:/app/docker-files/config \
  lp-rebalancer
```

# Running External LP Rebalance with Docker

This guide explains how to run the Osmosis liquidity management tool using Docker, which is often easier than installing Node.js and managing dependencies directly.

## 🐳 Prerequisites

- Docker installed on your computer ([Download Docker](https://www.docker.com/products/docker-desktop/))
- Your wallet mnemonic phrase
- OSMO tokens on Osmosis (for gas - at least 3 OSMO)
- ARCH tokens on Archway (for gas - at least 30 ARCH)
- Liquidity tokens (e.g., ATOM and USDC)

## 📦 Supported Assets

The tool supports any Osmosis concentrated liquidity pool containing these tokens:
- ATOM, USDC, OSMO, TIA, INJ, WBTC, WETH, AKT, ARCH

Default configuration uses pool 1282 (ATOM/USDC 0.05% fee tier).

## 🚀 Quick Start with Docker Compose (Recommended)

### 1. Set Up Your Environment

Create a `.env` file in the project folder:
```bash
# Required
MNEMONIC="your twelve or twenty four word secret phrase"

# Optional - defaults shown
WATCH_FREQUENCY=300                           # Check interval in seconds
OSMOSIS_POOL_ID=1282                          # Pool ID from app.osmosis.zone/pools
REBALANCE_THRESHOLD_PERCENT=95                # Rebalance at 95% out of range
OSMOSIS_POSITION_BAND_PERCENTAGE=1            # ±1% from current price
CONFIG_FILE=./docker-files/config/config.json # Config file to read and write from
```

### 2. Start the Service
```bash
# Start in watch mode (checks every 5 minutes by default)
docker compose up -d

# View logs
docker compose logs -f

# Stop the service
docker compose stop

# Stop and remove the container
docker compose down
```

### 3. Access Your Data

Docker stores data in `docker-files/` to prevent conflicts:
- **Logs**: `./docker-files/logs/`
- **Database**: `./docker-files/database/`
- **Reports**: `./docker-files/reports/`
- **Config**: `./docker-files/config/`

## 🔧 Using Plain Docker (Alternative Method)

If you prefer not to use Docker Compose:

### Build the Image
```bash
docker build -t lp-rebalancer .
```

### Run Different Commands
```bash
# Check status
docker run --rm \
  -e MNEMONIC="your mnemonic phrase" \
  -v $(pwd)/docker-files/logs:/app/logs \
  -v $(pwd)/docker-files/database:/app/database \
  -v $(pwd)/docker-files/reports:/app/reports \
  -v $(pwd)/docker-files/config:/app/docker-files/config \
  lp-rebalancer npm run status

# Run once (create/rebalance)
docker run --rm \
  -e MNEMONIC="your mnemonic phrase" \
  -v $(pwd)/docker-files/logs:/app/logs \
  -v $(pwd)/docker-files/database:/app/database \
  -v $(pwd)/docker-files/reports:/app/reports \
  -v $(pwd)/docker-files/config:/app/docker-files/config \
  lp-rebalancer npm start

# Run in watch mode (continuous monitoring)
docker run -d \
  --name lp-rebalancer \
  -e MNEMONIC="your mnemonic phrase" \
  -e WATCH_FREQUENCY=600 \
  -v $(pwd)/docker-files/logs:/app/logs \
  -v $(pwd)/docker-files/database:/app/database \
  -v $(pwd)/docker-files/reports:/app/reports \
  -v $(pwd)/docker-files/config:/app/docker-files/config \
  lp-rebalancer

# View logs of running container
docker logs -f lp-rebalancer

# Stop the container
docker stop lp-rebalancer
docker rm lp-rebalancer
```

### Windows Users

Replace `$(pwd)` with `%cd%` in Command Prompt or `${PWD}` in PowerShell:
```cmd
# Command Prompt
docker run --rm -e MNEMONIC="your mnemonic" -v %cd%/docker-files/logs:/app/logs -v %cd%/docker-files/database:/app/database -v %cd%/docker-files/reports:/app/reports -v %cd%/docker-files/config:/app/docker-files/config lp-rebalancer npm run status

# PowerShell
docker run --rm -e MNEMONIC="your mnemonic" -v ${PWD}/docker-files/logs:/app/logs -v ${PWD}/docker-files/database:/app/database -v ${PWD}/docker-files/reports:/app/reports -v ${PWD}/docker-files/config:/app/docker-files/config lp-rebalancer npm run status
```

## 📊 Managing Your Position

### View Status
```bash
# With Docker Compose
docker compose exec app npm run status

# With plain Docker (while container is running)
docker exec lp-rebalancer npm run status
```

### Generate Reports
```bash
# Full report
docker compose exec app npm run report

# Volume analysis
docker compose exec app npm run volume

# Profit/loss
docker compose exec app npm run profit

# With CSV export
docker compose exec app npm run report -- --csv
```

CSV files are saved to `/docker-files/reports/`.

### Withdraw Position
```bash
# Stop the watch mode first
docker compose stop

# Run withdrawal
docker compose run --rm app npm run withdraw
```

## 🔄 Configuring Watch Interval

The default check interval is 300 seconds (5 minutes). To change it:

### Method 1: Environment Variable in .env
```bash
# .env file
WATCH_FREQUENCY=600  # Check every 10 minutes
```

### Method 2: Override when running
```bash
# With docker compose
WATCH_FREQUENCY=1800 docker compose up -d

# With plain docker
docker run -d --name lp-rebalancer -e WATCH_FREQUENCY=900 ... lp-rebalancer
```

### Method 3: In docker-compose.yaml
```yaml
environment:
  - WATCH_FREQUENCY=1200  # 20 minutes
```

## 🎯 Using Different Pools

To manage a different pool:

1. Find your pool ID at [app.osmosis.zone/pools](https://app.osmosis.zone/pools)
2. Update `docker-config.json`:
```json
{
  "osmosisPool": {
    "id": "1265",  // Your new pool ID
    "token0": "",  // Leave empty - auto-filled
    "token1": "",  // Leave empty - auto-filled
    "tickSpacing": 0,  // Leave as 0 - auto-filled
    "spreadFactor": 0  // Leave as 0 - auto-filled
  }
}
```

Or use environment variable:
```bash
OSMOSIS_POOL_ID=1265
```

The tool will automatically fetch pool parameters when it starts.

## 📁 Data Persistence

Docker uses the `docker-files/` directory structure:

| Data Type | Container Path | Host Path |
|-----------|---------------|-----------|
| Logs | `/app/logs` | `./docker-files/logs/` |
| Database | `/app/database` | `./docker-files/database/` |
| Reports | `/app/reports` | `./docker-files/reports/` |
| Config | `/app/config` | `./docker-files/config/` |

These directories persist between container restarts.

## 🛠️ Troubleshooting

### Container Won't Start

Check logs for errors:
```bash
docker compose logs app
```

Common issues:
- Missing `.env` file
- Invalid mnemonic format
- Permission issues with mounted volumes

### Can't Access Data

Ensure directories exist and have correct permissions:
```bash
mkdir -p docker-files/logs docker-files/database docker-files/reports
chmod 755 docker-files/*
```

### Memory Issues

Add memory limits to docker-compose.yaml if needed:
```yaml
services:
  app:
    mem_limit: 512m
    memswap_limit: 1g
```

### Graceful Shutdown

The container waits up to 2 minutes for operations to complete before shutting down. To force immediate stop:
```bash
docker compose kill
```

## 🔐 Security Considerations

1. **Environment Variables**
   - Never commit `.env` file to version control
   - Use Docker secrets for production deployments
   - Consider using encrypted environment files

2. **File Permissions**
   - The container runs as non-root user (nodejs)
   - Mounted volumes should be readable/writable
   - Protect your `.env` file: `chmod 600 .env`

3. **Network Security**
   - Container only needs outbound internet access
   - No ports are exposed by default
   - Consider using Docker networks for isolation

## 🔄 Updating

To update to a new version:
```bash
# Stop current container
docker compose down

# Pull latest code
git pull

# Rebuild image
docker compose build --no-cache

# Start updated container
docker compose up -d
```

## 📈 Monitoring

### Real-time Logs
```bash
# All logs
docker compose logs -f

# Last 100 lines
docker compose logs --tail=100 -f
```

### Health Checks

Check if the container is running:
```bash
docker compose ps
```

### Resource Usage
```bash
docker stats lp-rebalancer
```

## 🆘 Emergency Procedures

### Stop All Operations
```bash
# Graceful stop
docker compose stop

# Force stop
docker compose kill
```

### Backup Data
```bash
# Create backup
tar -czf backup-$(date +%Y%m%d).tar.gz docker-files

# Restore backup
tar -xzf backup-20240115.tar.gz
```

## 💡 Tips

1. **Multiple Positions**
   - Run multiple containers with different configs
   - Use different project names: `docker compose -p position1 up -d`

2. **Automated Backups**
   - Add a cron job to backup the database regularly
   - Store backups securely off-site

3. **Monitoring Integration**
   - Export logs to monitoring services
   - Set up alerts for errors or position changes

4. **Custom Check Intervals**
   - Short intervals (60-300s) for volatile markets
   - Longer intervals (600-1800s) for stable positions
   - Consider gas costs when setting frequency

---

*For non-Docker instructions, see the main [README.md](README.md)*

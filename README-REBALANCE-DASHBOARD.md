# Rebalance Dashboard

A real-time monitoring dashboard for Bolt liquidity pools that displays pool balances, swap_buy transaction breakdowns, and balance changes over time.

## Features

- **Real-time Pool Data**: Current balances for SUI and USDC pools
- **Price Information**: Live token prices
- **Swap_buy Breakdown**: Detailed breakdown of swap_buy transactions with asset amounts and USD values
- **Balance Change Tracking**: Shows changes in pool balances between refreshes
- **Historical Comparison**: Keeps previous data visible for manual comparison
- **Auto-refresh**: Optional automatic refresh at configurable intervals

## Prerequisites

1. **Node.js** (version 16 or higher)
2. **grpcurl** - Required for querying Bolt gRPC endpoint
   ```bash
   brew install grpcurl
   ```
3. **Dependencies** - Install project dependencies:
   ```bash
   npm install
   ```

## Installation

1. Navigate to the project directory:
   ```bash
   cd /Users/maxmckendry/Desktop/philabs-lp-rebalance-sui
   ```

2. Install dependencies (if not already done):
   ```bash
   npm install
   ```

3. Verify grpcurl is installed:
   ```bash
   which grpcurl
   ```

## Usage

### Basic Usage (Single Run)

Run the dashboard once without auto-refresh:

**Using npm:**
```bash
npm run cli -- rebalance-dashboard
```

**Using npx:**
```bash
npx tsx src/cli/index.ts rebalance-dashboard
```

### Auto-refresh Mode

Run the dashboard with automatic refresh every N seconds:

**Using npm:**
```bash
npm run cli -- rebalance-dashboard --refresh 100
```

**Using npx:**
```bash
npx tsx src/cli/index.ts rebalance-dashboard --refresh 100
```

This will refresh the dashboard every 100 seconds and keep all previous data visible for comparison.

### Command Options

- `--refresh <seconds>` - Auto-refresh interval in seconds (default: no auto-refresh)
  
  **Using npm:**
  ```bash
  npm run cli -- rebalance-dashboard --refresh 60
  ```
  
  **Using npx:**
  ```bash
  npx tsx src/cli/index.ts rebalance-dashboard --refresh 60
  ```

- `--endpoint <endpoint>` - Custom Bolt gRPC endpoint (default: `144.76.3.52:50063`)
  
  **Using npm:**
  ```bash
  npm run cli -- rebalance-dashboard --endpoint YOUR_ENDPOINT:PORT
  ```
  
  **Using npx:**
  ```bash
  npx tsx src/cli/index.ts rebalance-dashboard --endpoint YOUR_ENDPOINT:PORT
  ```

- `--debug` - Show debug information including raw API responses
  
  **Using npm:**
  ```bash
  npm run cli -- rebalance-dashboard --debug
  ```
  
  **Using npx:**
  ```bash
  npx tsx src/cli/index.ts rebalance-dashboard --debug
  ```

- `--help` - Display help information
  
  **Using npm:**
  ```bash
  npm run cli -- rebalance-dashboard --help
  ```
  
  **Using npx:**
  ```bash
  npx tsx src/cli/index.ts rebalance-dashboard --help
  ```

## What the Dashboard Shows

### 1. Prices Section
- Current SUI price in USD

### 2. Pool Balances (Base)
- USDC pool base amount (tokens and USD value)
- SUI pool base amount (tokens and USD value)
- Previous values shown below current values (after first refresh)

### 3. Pool Balances (Quote)
- SUI pool quote assets (USDC)
- USDC pool quote assets (SUI)
- Previous values shown below current values (after first refresh)

### 4. Total Pool Liquidity
- Combined USD value of all pool assets
- Previous total shown below (after first refresh)

### 5. Swap_buy Breakdown
- Breakdown of all swap_buy transactions since last refresh
- Shows input/output amounts and USD values by token
- Total transaction count and volume

### 6. Pool Balance Changes
- Changes in each pool balance since last refresh
- Shows both token amounts and USD value changes
- Total change across all pools

## Example Output

```
╠══════════════════════════════════════════════════════════════════════════════╣
║  📊 PRICES                                                                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  SUI Price:  $2.45                                                           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║POOL BALANCES (Base)                                                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  USDC   | 1000.00 tokens = $1000.00 USD                                      ║
║         (prev: 995.00 tokens = $995.00 USD)                                 ║
║  SUI    | 500.00 tokens = $1225.00 USD                                       ║
║         (prev: 498.50 tokens = $1221.33 USD)                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
...
```

## Stopping the Dashboard

Press `Ctrl + C` in the terminal to stop the dashboard.

## Troubleshooting

### "command not found: tsx"
If you encounter this error, use `npx` to run tsx directly:

```bash
npx tsx src/cli/index.ts rebalance-dashboard --refresh 100
```

Alternatively, you can use the npm command which handles this automatically:

```bash
npm run cli -- rebalance-dashboard --refresh 100
```

### "grpcurl: command not found"
Install grpcurl:
```bash
brew install grpcurl
```

### Connection Errors
- Verify network access to the Bolt gRPC endpoint
- Check if the endpoint is correct: `144.76.3.52:50063`
- Try using `--debug` flag to see detailed error messages

### No Previous Data on First Run
- This is normal - previous values will appear after the first refresh
- On first run, swap_buy transactions from the last hour are shown

## Database

The dashboard uses a local SQLite database (created automatically) or PostgreSQL if `DATABASE_URL` is set in your `.env` file. No database setup is required for basic usage.

## Pool Identifiers

The dashboard monitors these pools:
- **SUI Pool**: `0x21167b2e981e2c0a693afcfe882a3a827d663118e19afcb92e45bfe43fe56278`
- **USDC Pool**: `0x34fcaa553f1185e1c3a05de37b6a4d10c39535d19f9c8581eeae826434602b58`

## Notes

- The dashboard keeps all previous data visible - scroll up to compare multiple refreshes
- Each refresh is separated by a timestamp line for easy identification
- Previous values are shown below current values for quick comparison
- Swap_buy transactions are tracked from the database and shown with USD conversions


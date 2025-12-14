# Monitoring Dashboard

This monitoring dashboard provides real-time visibility into Bolt pool balances for SUI and USDC pools.

## Usage

### Basic Usage

Run the monitoring dashboard:

```bash
npm run monitor
```

Or directly:

```bash
tsx src/cli/index.ts monitor
```

### Auto-refresh

To enable auto-refresh every N seconds:

```bash
npm run monitor -- --refresh 10
```

This will refresh the dashboard every 10 seconds.

### Custom Endpoint

To use a custom Bolt gRPC endpoint:

```bash
npm run monitor -- --endpoint 144.76.3.52:50063
```

## Features

- **Real-time Pool Data**: Fetches current pool balances from Bolt settlement service
- **Token Balances**: Shows amounts in both tokens (SUI and USDC) and USD equivalent
- **Price Information**: Displays current token prices from Bolt
- **Summary View**: Aggregated totals across both pools
- **Clean Interface**: Formatted CLI output with clear sections

## Requirements

- `grpcurl` must be installed and available in your PATH
- Network access to Bolt gRPC endpoint (144.76.3.52:50063)

## Pool Identifiers

- **SUI Pool**: `0x21167b2e981e2c0a693afcfe882a3a827d663118e19afcb92e45bfe43fe56278`
- **USDC Pool**: `0x34fcaa553f1185e1c3a05de37b6a4d10c39535d19f9c8581eeae826434602b58`

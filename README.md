# Rebalance Dashboard for Sui

Real-time monitoring dashboard for Bolt liquidity pools on Sui blockchain.

## Features

- 📊 **Real-time Pool Monitoring**: Track SUI and USDC pool balances
- 💰 **Price Tracking**: Live token prices from multiple sources
- 🔄 **Swap_buy Breakdown**: Detailed analysis of swap transactions
- 📈 **Balance Change Tracking**: Monitor pool balance changes over time
- 📜 **Historical Comparison**: Compare current and previous values side-by-side
- ⏱️ **Auto-refresh**: Configurable automatic refresh intervals

## Quick Start

```bash
# Install dependencies
npm install

# Install grpcurl (required)
brew install grpcurl

# Run the dashboard
npm run cli -- rebalance-dashboard --refresh 100
```

## Documentation

- **[README-REBALANCE-DASHBOARD.md](README-REBALANCE-DASHBOARD.md)** - Complete usage guide
- **[INSTALLATION.md](INSTALLATION.md)** - Detailed installation instructions
- **[PACKAGE-CONTENTS.md](PACKAGE-CONTENTS.md)** - Package structure overview

## Requirements

- Node.js (v16+)
- grpcurl
- npm packages (see package.json)

## Usage

```bash
# Single run
npm run cli -- rebalance-dashboard

# Auto-refresh every 100 seconds
npm run cli -- rebalance-dashboard --refresh 100

# Custom endpoint
npm run cli -- rebalance-dashboard --endpoint YOUR_ENDPOINT:PORT

# Debug mode
npm run cli -- rebalance-dashboard --debug
```

## What It Monitors

- **SUI Pool**: `0x21167b2e981e2c0a693afcfe882a3a827d663118e19afcb92e45bfe43fe56278`
- **USDC Pool**: `0x34fcaa553f1185e1c3a05de37b6a4d10c39535d19f9c8581eeae826434602b58`

## License

See package.json for license information.

## Contributing

This is a monitoring tool for Bolt liquidity pools. For issues or questions, please open an issue on GitHub.

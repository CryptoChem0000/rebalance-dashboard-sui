# Rebalance Dashboard Package Contents

This package contains all files necessary to run the rebalance dashboard.

## Directory Structure

```
rebalance-dashboard-package/
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── rebalance-dashboard.ts  # Main dashboard command
│   │   │   └── index.ts                # Command exports
│   │   └── index.ts                    # CLI entry point
│   ├── monitoring/
│   │   ├── bolt-grpc-client.ts         # Bolt gRPC client
│   │   ├── price-service.ts            # Price fetching service
│   │   └── index.ts
│   ├── database/
│   │   ├── types/                      # Database type definitions
│   │   ├── sqlite-transaction-repository.ts
│   │   ├── postgres-transaction-repository.ts
│   │   └── database-query-client.ts
│   ├── utils/                          # Utility functions
│   ├── key-manager/                    # Key management
│   └── registry/                       # Chain and token registry
├── README-REBALANCE-DASHBOARD.md       # Main documentation
├── INSTALLATION.md                     # Installation guide
├── package.json                        # Dependencies reference
└── .env.example                        # Environment variables template
```

## Required Dependencies

Install these npm packages:
- commander
- bignumber.js
- better-sqlite3 (or @prisma/client for PostgreSQL)
- tsx
- @mysten/sui
- @bolt-liquidity-hq/sui-client
- axios

See package.json for complete list.

## External Requirements

- Node.js (v16+)
- grpcurl (install via: `brew install grpcurl`)

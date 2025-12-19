#!/bin/bash

# Create package directory
PACKAGE_DIR="rebalance-dashboard-package"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

# Copy main dashboard file
mkdir -p "$PACKAGE_DIR/src/cli/commands"
cp src/cli/commands/rebalance-dashboard.ts "$PACKAGE_DIR/src/cli/commands/"

# Copy CLI files
cp src/cli/commands/index.ts "$PACKAGE_DIR/src/cli/commands/"
cp src/cli/index.ts "$PACKAGE_DIR/src/cli/"

# Copy monitoring files
mkdir -p "$PACKAGE_DIR/src/monitoring"
cp -r src/monitoring/* "$PACKAGE_DIR/src/monitoring/"

# Copy database files
mkdir -p "$PACKAGE_DIR/src/database/types"
cp -r src/database/*.ts "$PACKAGE_DIR/src/database/" 2>/dev/null
cp -r src/database/types/*.ts "$PACKAGE_DIR/src/database/types/" 2>/dev/null

# Copy utils
mkdir -p "$PACKAGE_DIR/src/utils"
cp src/utils/index.ts "$PACKAGE_DIR/src/utils/" 2>/dev/null
cp src/utils/account.ts "$PACKAGE_DIR/src/utils/" 2>/dev/null

# Copy key-manager
mkdir -p "$PACKAGE_DIR/src/key-manager/key-stores"
mkdir -p "$PACKAGE_DIR/src/key-manager/types"
mkdir -p "$PACKAGE_DIR/src/key-manager/constants"
cp src/key-manager/index.ts "$PACKAGE_DIR/src/key-manager/" 2>/dev/null
cp src/key-manager/manager.ts "$PACKAGE_DIR/src/key-manager/" 2>/dev/null
cp src/key-manager/key-stores/*.ts "$PACKAGE_DIR/src/key-manager/key-stores/" 2>/dev/null
cp src/key-manager/types/*.ts "$PACKAGE_DIR/src/key-manager/types/" 2>/dev/null
cp src/key-manager/constants/*.ts "$PACKAGE_DIR/src/key-manager/constants/" 2>/dev/null

# Copy registry
mkdir -p "$PACKAGE_DIR/src/registry/types"
mkdir -p "$PACKAGE_DIR/src/registry/utils"
cp src/registry/index.ts "$PACKAGE_DIR/src/registry/" 2>/dev/null
cp src/registry/sui.ts "$PACKAGE_DIR/src/registry/" 2>/dev/null
cp src/registry/types/*.ts "$PACKAGE_DIR/src/registry/types/" 2>/dev/null
cp src/registry/utils/*.ts "$PACKAGE_DIR/src/registry/utils/" 2>/dev/null
cp src/registry/all-chains.ts "$PACKAGE_DIR/src/registry/" 2>/dev/null

# Copy README
cp README-REBALANCE-DASHBOARD.md "$PACKAGE_DIR/"

# Copy package.json for reference
cp package.json "$PACKAGE_DIR/"

# Copy .env.example
cp .env.example "$PACKAGE_DIR/" 2>/dev/null || true

# Create installation instructions
cat > "$PACKAGE_DIR/INSTALLATION.md" << 'INSTALL'
# Installation Instructions

## Quick Start

1. Extract this package to your project directory
2. Install dependencies:
   ```bash
   npm install
   ```

3. Install grpcurl (required):
   ```bash
   brew install grpcurl
   ```

4. Set up your environment (optional):
   - Copy `.env.example` to `.env`
   - Add your mnemonic if needed (for database access)

5. Run the dashboard:
   ```bash
   npm run cli -- rebalance-dashboard --refresh 100
   ```

## Integration into Existing Project

If you're integrating this into an existing project:

1. Copy the `src/` directory contents to your project's `src/` directory
2. Ensure all dependencies from `package.json` are installed
3. Make sure your CLI index file imports and registers the command:
   ```typescript
   import { rebalanceDashboardCommand } from "./commands";
   rebalanceDashboardCommand(program);
   ```

## Dependencies

Required npm packages (from package.json):
- commander
- bignumber.js
- better-sqlite3 (or @prisma/client for PostgreSQL)
- tsx (for running TypeScript)

See package.json for the complete list.
INSTALL

echo "Package created in $PACKAGE_DIR"
echo "Files included:"
find "$PACKAGE_DIR" -type f | wc -l | xargs echo "Total files:"

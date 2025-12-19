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

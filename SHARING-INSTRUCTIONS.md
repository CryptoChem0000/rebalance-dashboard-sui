# Sharing the Rebalance Dashboard Package

## Package Created

A complete package has been created at:
- **Zip File**: `rebalance-dashboard-package.zip` (47KB)
- **Unpacked Directory**: `rebalance-dashboard-package/`

## What's Included

The package contains:
- ✅ Complete rebalance dashboard command
- ✅ All required dependencies (monitoring, database, utils, key-manager, registry)
- ✅ CLI integration files
- ✅ README documentation
- ✅ Installation instructions
- ✅ Package contents guide
- ✅ Environment variable template

## Sharing Instructions

### Option 1: Share the Zip File
Simply share the `rebalance-dashboard-package.zip` file. Recipients can:
1. Extract the zip file
2. Follow the `INSTALLATION.md` guide
3. Run the dashboard

### Option 2: Share the Directory
Share the entire `rebalance-dashboard-package/` directory (zip it first for easier transfer).

## What Recipients Need

1. **Node.js** (v16 or higher)
2. **grpcurl** - Install via: `brew install grpcurl`
3. **npm packages** - Install dependencies from `package.json`

## Quick Start for Recipients

```bash
# 1. Extract the package
unzip rebalance-dashboard-package.zip

# 2. Navigate to extracted directory
cd rebalance-dashboard-package

# 3. Install dependencies
npm install

# 4. Install grpcurl
brew install grpcurl

# 5. Run the dashboard
npm run cli -- rebalance-dashboard --refresh 100
```

## File Locations

- **Main Dashboard**: `src/cli/commands/rebalance-dashboard.ts`
- **Documentation**: `README-REBALANCE-DASHBOARD.md`
- **Installation Guide**: `INSTALLATION.md`
- **Package Contents**: `PACKAGE-CONTENTS.md`

## Notes

- The package is self-contained and includes all necessary source files
- No sensitive data is included (no .env files, only .env.example)
- Test files are excluded from the package
- The package can be integrated into existing projects or used standalone

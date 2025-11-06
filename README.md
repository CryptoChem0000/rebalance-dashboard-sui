# External LP Rebalance with Bolt

## 🎯 What Does This Do?

This tool automatically manages your liquidity positions on Osmosis DEX. When you provide liquidity on Osmosis, you need to keep your position "in range" to earn fees. This tool:

1. **Creates liquidity positions** for you automatically
2. **Monitors** if your position goes out of range
3. **Rebalances** your position when needed (withdraws and recreates it)
4. **Uses Bolt on Archway** to get better prices when rebalancing
5. **Tracks all your transactions** in a database for analysis

## 📦 Supported Assets

Currently supported token pairs:
- **ATOM/USDC** (default configuration - Pool 1282)
- **Any pool** containing these supported tokens:
  - ATOM (Cosmos Hub)
  - USDC (Noble)
  - OSMO (Osmosis)
  - TIA (Celestia)
  - INJ (Injective)
  - WBTC (Wrapped Bitcoin via Osmosis)
  - WETH (Wrapped Ethereum via Axelar)
  - AKT (Akash)
  - ARCH (Archway)

You can use any Osmosis concentrated liquidity pool that contains two of these tokens.

## 🚀 Getting Started (Step by Step)

### Prerequisites

Before you start, you'll need:
- A computer with Node.js installed (version 16 or higher)
- Some OSMO tokens on Osmosis (for gas fees - at least 3 OSMO)
- Some ARCH tokens on Archway (for gas fees - at least 30 ARCH)
- Tokens to provide as liquidity (e.g., ATOM and USDC)
- Basic familiarity with using a terminal/command line

### Step 1: Installation

1. Download or clone this project to your computer
2. Open a terminal in the project folder
3. Run this command:

```bash
npm install
```

### Step 2: Set Up Your Wallet

1. Create a new file called `.env` in the project folder
2. Add your wallet's secret phrase (mnemonic) to it:

```
MNEMONIC="your twelve or twenty four word secret phrase goes here"
```

⚠️ **SECURITY WARNING**: 
- Never share your mnemonic with anyone!
- Use a dedicated wallet for this tool, not your main wallet
- Only keep the funds you want to manage in this wallet
- The wallet must be the same on both Osmosis and Archway chains

### Step 3: Configure Your Settings

The `config.json` file controls how the tool operates:

```json
{
  "rebalanceThresholdPercent": 95,
  "osmosisPool": {
    "id": "1282",
    "token0": "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
    "token1": "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
    "tickSpacing": 100,
    "spreadFactor": 0.0005
  },
  "osmosisPosition": {
    "id": "",
    "bandPercentage": 1
  }
}
```

**What these settings mean:**
- `rebalanceThresholdPercent`: When your position is 95% out of balance, it rebalances
- `id`: The Osmosis pool ID (find your pool at app.osmosis.zone/pools)
- `token0/token1`: The token addresses in the pool
- `tickSpacing`: How precise the price ranges are (100 is standard)
- `spreadFactor`: The fee tier (0.0005 = 0.05% fees)
- `bandPercentage`: Your position's price range width (1 = ±1% from current price)

**Finding Your Pool:**
1. Go to [app.osmosis.zone/pools](https://app.osmosis.zone/pools)
2. Find a concentrated liquidity pool with your desired tokens
3. The pool ID is in the URL (e.g., /pool/1282)

**Environment Variable Overrides:**
You can override config settings using environment variables:
- `REBALANCE_THRESHOLD_PERCENT` - When to rebalance (default: from config)
- `OSMOSIS_POOL_ID` - Override the pool ID
- `OSMOSIS_POSITION_BAND_PERCENTAGE` - Position range width
- `WATCH_FREQUENCY` - Check interval in seconds (default: 300)

## 📋 Available Commands

### Check Your Status

See your current pool and position status:

```bash
npm run status
```

Shows:
- Your pool information
- Current position details
- Whether your position is in range
- Visual representation of position balance

### Create or Rebalance Position

Run the liquidity management process:

```bash
npm start
```

This will:
- Create a position if you don't have one
- Rebalance if your position is out of range
- Bridge tokens between chains if needed
- Swap tokens on Bolt for better prices

### Watch Mode (Automatic Monitoring)

Keep the tool running and check every 5 minutes:

```bash
npm start -- --watch 300
```

Change `300` to any number of seconds (e.g., 600 for 10 minutes).

### Withdraw Your Position

Remove all liquidity and get your tokens back:

```bash
npm run withdraw
```

### View Reports and Statistics

```bash
# Full report of all activity
npm run report

# Trading volume breakdown
npm run volume

# Profitability analysis
npm run profit

# Transaction statistics
npm run stats
```

Add `-- --csv` to any report command to export to CSV files in the `reports/` folder.

### Using with Custom Log Files

Add `-- --log-file mylog.log` to any command to use a specific log file name.

### Disable writing to log files

Add `-- --no-log` to any command so no log files are written.

### Change config file location

Add `-- --config-file myconfig.json` to use another file instead of `config.json`.

## 🎮 Example Workflows

### First Time Setup

```bash
# 1. Check initial status
npm run status

# 2. Create your first position
npm start

# 3. Verify it was created
npm run status
```

### Daily Management

```bash
# Option 1: Manual check and rebalance
npm run status
npm start  # Only rebalances if needed

# Option 2: Continuous monitoring
npm start -- --watch 600  # Checks every 10 minutes
```

### Using Different Pools

To use a different pool, edit `config.json`:

```json
{
  "osmosisPool": {
    "id": "1265",  // OSMO/USDC pool
    "token0": "",  // Leave empty - will be auto-filled
    "token1": "",  // Leave empty - will be auto-filled
    "tickSpacing": 0,  // Leave as 0 - will be auto-filled
    "spreadFactor": 0  // Leave as 0 - will be auto-filled
  }
}
```

The tool will automatically fetch and update the pool parameters.

### Weekly Analysis

```bash
# Check your profits
npm run profit

# View volume statistics
npm run volume

# Generate full report
npm run report -- --csv
```

### Emergency Exit

```bash
# Withdraw everything immediately
npm run withdraw

# Verify withdrawal
npm run status
```

## 📊 Understanding the Output

### Position Range Visual

When you run `status`, you'll see:

```
0%                       50%                      100%
[=======================●-------------------------]
```

- The `●` shows your current position
- Near 0%: Your position holds mostly token1 (token0 price went up)
- Near 100%: Your position holds mostly token0 (token0 price went down)
- The tool rebalances at 5% or 95% by default

### Transaction Database

All operations are recorded in a local SQLite database:
- Located in `database/[your-address].db`
- Tracks swaps, bridges, position changes
- Used for profit/loss calculations

### Log Files

Detailed logs are saved in the `logs/` folder:
- Each run creates a timestamped log file
- Check these if something goes wrong
- Contains detailed transaction information

### CSV Reports

Reports can be exported to the `reports/` folder:
- Transaction history
- Volume analysis by token
- Profitability breakdown
- Statistical summaries

## 🔧 Troubleshooting

### Common Issues

**"Not enough OSMO balance for paying gas fees"**
- You need at least 0.1 OSMO on Osmosis for transactions
- Keep extra for multiple operations

**"Not enough ARCH balance for paying gas fees"**
- You need at least 1 ARCH on Archway for swaps/bridges
- Required when rebalancing positions

**"Position out of range"**
- This is normal and why the tool exists!
- Run `npm start` to rebalance

**"Token not found in registry"**
- The pool uses tokens not yet supported by this tool
- Check the supported assets list above

**"No pool configured yet"**
- The config file needs a pool ID
- Find a pool ID from app.osmosis.zone/pools

**"Transaction failed"**
- Check the log files for detailed errors
- Ensure sufficient gas on both chains
- Try running the command again

## 🛡️ Security Best Practices

1. **Wallet Security**
   - Use a dedicated wallet for this tool
   - Never use your main wallet
   - Keep minimal funds (only what you're managing)

2. **Backup Your Keys**
   - Save your mnemonic phrase securely
   - Never share it with anyone
   - Consider using a hardware wallet for large amounts

3. **Monitor Your Positions**
   - Check status regularly even in watch mode
   - Review transaction logs
   - Verify balances match expectations

4. **Environment Files**
   - Never commit `.env` to version control
   - Set file permissions to restrict access
   - Use strong mnemonics (24 words preferred)

## 📈 Understanding Costs

Running this tool involves several costs:

1. **Gas Fees**
   - Osmosis: ~0.025-0.1 OSMO per transaction
   - Archway: ~0.1-0.3 ARCH per transaction

2. **Swap Fees**
   - Bolt swap fee: Variable based on liquidity
   - Bridge fees: Minimal IBC transfer costs

3. **Position Management**
   - Creating position: ~0.02 OSMO
   - Withdrawing position: ~0.03 OSMO
   - Each rebalance: Full cycle of withdraw + bridge + swap + create

## 🆘 Getting Help

1. **Check the documentation**
   - Review this README carefully
   - Look at example commands

2. **Examine logs**
   - Check `logs/` folder for detailed errors
   - Look for specific transaction hashes

3. **Verify balances**
   - Ensure sufficient tokens on both chains
   - Check gas token balances

4. **Common fixes**
   - Restart the tool
   - Update to latest version
   - Verify network connectivity

---

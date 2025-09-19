# External LP Rebalance with Bolt

## 🎯 What Does This Do?

When you provide liquidity on Osmosis, you need to keep your position "in range" to earn fees. This tool:

1. **Creates liquidity positions** for you automatically
2. **Monitors** if your position goes out of range
3. **Rebalances** your position when needed (withdraws and recreates it)
4. **Manages your funds** between Osmosis and Archway to get the best prices

## 🚀 Getting Started (Step by Step)

### Prerequisites

Before you start, you'll need:
- A computer with Node.js installed (version 16 or higher)
- Some OSMO tokens on the Osmosis Chain, and some ARCH tokens on the Archway Chain in your wallet for gas fees.
- A meaningful amount of ATOM and/or USDC tokens on the Osmosis Chain to be used in the pool as liquidity.
- Basic familiarity with using a terminal/command line

### Step 1: Installation

1. Download or clone this project to your computer
2. Open a terminal in the project folder
3. Run these commands:

```bash
npm install
```

### Step 2: Set Up Your Wallet

1. Create a new file called `.env` in the project folder
2. Add your wallet's secret phrase (mnemonic) to it like this:

```
MNEMONIC="your twelve or twenty four word secret phrase goes here"
```

⚠️ **IMPORTANT**: 
- Never share your mnemonic with anyone!
- Use a dedicated wallet for this tool, not your main wallet
- Keep only the funds you want to manage in this wallet

### Step 3: Configure Your Settings

There is a file called `config.json` in the project folder with these settings:

```json
{
  "rebalanceThresholdPercent": 95, // Percentage of imbalance (95%) where the position will be rebalanced
  "osmosisPool": {
    "id": "1282", // Existing pool we can use
    "token0": "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", // ATOM
    "token1": "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4", // USDC
    "tickSpacing": 100, // Existing pool config
    "spreadFactor": 0.0005 // Existing pool config
  },
  "osmosisPosition": {
    "id": "", // Empty if no position has been created yet, otherwise it is an existing position Id
    "bandPercentage": 1 // New positions will be created with a band 1% up and a 1% down from the current market price
  }
}
```

**What these settings mean:**
- `rebalanceThresholdPercent`: When your position gets 95% out of range, it will rebalance
- `token0/token1`: The token pair you want to provide liquidity for (currently we only support ATOM/USDC)
- `tickSpacing`: How precise the price ranges are (100 is standard on osmosis)
- `spreadFactor`: The fee tier (0.0005 = 0.05% fees)
- `bandPercentage`: How wide your price range is (10 = ±10% from current price)

## 📋 Available Commands

### Check Your Status

See your current pool and position status:

```bash
npm run status
```

This shows:
- Your pool information
- Your current position details
- Whether your position is in range
- A visual representation of where your position sits

### Create or Rebalance Position

Run the liquidity management process:

```bash
npm run start
```

This will:
- Create a pool if you don't have one
- Create a position if you don't have one
- Rebalance if your position is out of range

### Watch Mode (Automatic Monitoring)

Keep the tool running and check every 5 minutes (300 seconds):

```bash
npm run start -- --watch 300
```

You can change `300` to any number of seconds you prefer.

### Withdraw Your Position

Remove your liquidity and get your tokens back:

```bash
npm run withdraw
```

This will:
- Withdraw all your liquidity
- Return your tokens to your wallet
- Clear the position from your config

### Using Testnet

NOTE: Osmosis testnet DEX router doesn't support tokens other than OSMO and ION, so we can't use testnet for now

To test with fake tokens first:

```bash
npm run status -- --environment testnet
npm run start -- --environment testnet
npm run withdraw -- --environment testnet
```

## 🎮 Example Workflow

Here's how a typical user might use this tool:

1. **First Time Setup**
   ```bash
   # Check initial status
   npm run status
   
   # Create your first position
   npm run start
   
   # Check the results
   npm run status
   ```

2. **Daily Management**
   ```bash
   # Option 1: Manual check and rebalance
   npm run status
   npm run start  # Only rebalances if needed
   
   # Option 2: Let it run automatically
   npm run start -- --watch 600  # Checks every 10 minutes
   ```

3. **When You Want to Exit your position**
   ```bash
   # Withdraw everything
   npm run withdraw
   
   # Verify withdrawal
   npm run status
   ```

## 🔧 Troubleshooting

### "No pool configured yet"
- This is normal on first run if it is not configured in the config file. Use the `run` command to create a pool.

### "No position configured yet"  
- This is normal. Use the `run` command to create a position.

### "Position out of range"
- This is what the tool is designed to handle! Use the `run` command to rebalance.

### "Insufficient gas balance"
- Make sure you have enough OSMO on Osmosis, and ARCH on Archway in your wallet for transaction fees
- Keep at least 1-2 OSMO for gas fees

### Logs
- All operations are logged to files in the `logs/` folder
- Check these files if something goes wrong

## 📊 Understanding the Visual Range

When you run `status`, you'll see something like:

```
0%                       50%                      100%
[=======================●-------------------------]
```

- The `●` shows where your current position is
- If it's near 0% or 100%, your position is almost out of range
- The tool rebalances when it reaches your threshold (default 95% on both sides, which means lower than 5% or higher than 95%)

## 🛟 Getting Help

1. Check the logs in the `logs/` folder for detailed error messages
2. Make sure your wallet has enough tokens and gas
3. Verify your `config.json` is properly formatted

---

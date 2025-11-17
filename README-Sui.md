# Sui Liquidity Management

## Quick Start

### Configuration

Create or edit `sui-config.json` in the project root:

```json
{
  "rebalanceThresholdPercent": 90,
  "cetusPool": {
    "id": "0x..."
  },
  "cetusPosition": {
    "id": "0x...",
    "bandPercentage": 1
  }
}
```

**Configuration Fields:**
- `rebalanceThresholdPercent`: Percentage threshold for rebalancing (e.g., 90 means rebalance when position is 90% out of range)
- `cetusPool.id`: The Cetus pool ID you want to manage
- `cetusPosition.id`: Your existing position ID (leave empty string `""` if creating a new position)
- `cetusPosition.bandPercentage`: Price band percentage for the position (e.g., 1 means ±1% from current price)

### Environment Variables

Set your Sui mnemonic in a `.env` file or environment variables:

```bash
SUI_MNEMONIC="your twelve word mnemonic phrase here"
```

### Running

Run the liquidity manager in watch mode (checks every 300 seconds):

```bash
npm run sui -- --watch 300
```

**Options:**
- `--watch <seconds>`: Keep running and check position every X seconds
- `--config-file <path>`: Path to custom config file (default: sui-config.json)

**Example:**
```bash
# Run once
npm run sui

# Run in watch mode checking every 5 minutes
npm run sui -- --watch 300
```

The manager will:
1. Check if the pool exists and load its information
2. Check if you have a position and if it needs rebalancing (based on `rebalanceThresholdPercent`)
3. If out of range, withdraw the position
4. Rebalance tokens using Bolt if needed to achieve ideal amounts
5. Create a new position with the optimal token amounts


# CLAMM Bot Environment Variables Setup Guide

## Overview

This guide explains how to configure environment variables for each CLAMM bot cloud deployment. The JSON configuration file has been replaced with GitHub Environment variables for better flexibility and control.

## Required Environment Configuration

For each bot (e.g., `clamm-bot-1`, `clamm-bot-2`), you need to create a GitHub Environment with the following:

### Environment Secrets
- `MNEMONIC` - The wallet mnemonic for the bot (keep this in Secrets, not Variables)

### Environment Variables
- `ENABLED` - Set to `"true"` to deploy the bot, or `"false"` to stop it
- `OSMOSIS_POOL_ID` - The Osmosis pool ID (e.g., "1282")
- `REBALANCE_THRESHOLD_PERCENT` - The rebalance threshold percentage (e.g., "95")
- `OSMOSIS_POSITION_BAND_PERCENTAGE` - The position band percentage (e.g., "1")
- `WATCH_FREQUENCY` - Watch frequency in seconds (e.g., "600")

## Understanding Rebalance Parameters

### Visual Representation
```
With OSMOSIS_POSITION_BAND_PERCENTAGE = 10:

Position Range:           $1.35 ←─────────────────────→ $1.65
                                │          ↑          │
                                │       Current       │
                                │        $1.50        │
                                └─────────────────────┘
                                       ±10% band
                               (centered on current price)

With REBALANCE_THRESHOLD_PERCENT = 95:

When price moves UP (95% of the road to the upper bound):
                          $1.35 ←─────────────────────→ $1.65
                                ↑                ↑    │
                                │             Current │
                                │              $1.365 │
                                │                │    │
                                │←──── 95% ─────→│←5%→│
                                                 │
                                         Rebalance triggered!

When price moves DOWN (95% closer to the lower bound):
                          $1.35 ←─────────────────────→ $1.65
                                │    ↑                ↑
                                │ Current.            │
                                │  $1.635             │
                                │    │                │
                                │←5%→│←───── 95% ────→│
                                     │
                              Rebalance triggered!

Safe Zone (price stays within the middle):
                          $1.35 ←─────────────────────→ $1.65
                                │←5%→│←── 90% ──→│←5%→│
                                │          ↑          │
                                │        Current      │
                                │        $1.50        │
                                │                     │
                                 No rebalancing needed
```

### Parameter Details

**OSMOSIS_POSITION_BAND_PERCENTAGE** (Allowed: 0.1 - 50)
- Defines the width of your concentrated liquidity position
- Example: `1` = ±1% around current price
- Smaller value = more concentrated = higher fees earned by the bot, but needs more rebalancing
- Larger value = less concentrated = lower fees earned by the bot, but needs less rebalancing

**REBALANCE_THRESHOLD_PERCENT** (Allowed: 51 - 99)
- Defines when to trigger a rebalance
- Example: `95` = rebalance when price moves more than 95% to either direction
- Higher value = wait longer before rebalancing (more tolerance)
- Lower value = rebalance more frequently (tighter control)

## Setting Up a New Bot

1. **Create GitHub Environment**
   - Go to Settings → Environments → New environment
   - Name it `my-bot-X`

2. **Add Environment Secrets**
```
   MNEMONIC = "your wallet mnemonic here"
```

3. **Add Environment Variables**
```
   ENABLED = "true"
   OSMOSIS_POOL_ID = "1282"
   REBALANCE_THRESHOLD_PERCENT = "95"
   OSMOSIS_POSITION_BAND_PERCENTAGE = "1"
   WATCH_FREQUENCY = "300"
```

## Managing Bot State

### To Deploy a Bot
Set `ENABLED = "true"` in the environment variables

### To Stop a Bot
Set `ENABLED = "false"` in the environment variables

When a bot is stopped:
- The deployment is scaled to 0 replicas
- All resources (PVC, ConfigMaps, Secrets) are preserved
- The bot can be restarted by setting `ENABLED = "true"`

## Deployment Workflows

### Deploy All Enabled Bots
Create and push a version tag to automatically build and deploy:
```bash
git tag v1.0.0
git push origin v1.0.0
```
This will:
1. Build a new Docker image
2. Deploy to all environments where `ENABLED = "true"`

### Deploy Specific Bots
Use the Deploy workflow with specific environments:
1. Go to Actions → Deploy CLAMM Bots → Run workflow
2. Enter:
   - `image_tag`: The Docker image tag to deploy (e.g., `v1.0.0`, `latest`), for simplicity use the pre-filled value: `latest`.
   - `environments`: Comma-separated list (e.g., `clamm-bot-1,clamm-bot-2`)
3. Click "Run workflow"

### Check Deployment Status
The deployment workflow outputs a summary table showing:
- Which bots are running (✅) or stopped (⏸️)
- Current image tag for each bot
- Last update time

To see this info, click on the deployment, then click on the summary box, then expand the `Generate deployment summary` option

# How to see Logs
To see the logs of your bot, login to https://08fa.grafana.archway.io/login

Then click on `Explore` on the left side of the screen.

After that, find the button that says `Select label`, and after clicking it, select `app_kubernetes_io_instance`
Next to it, there is another button that says `Select value`, click it, and select your bot (by its name).

Finally, click on the `Run query` button at the top right, and you should see the latest logs of your bot

# How to see a dashboard with stats of your bot
First login to the Grafana website https://08fa.grafana.archway.io/login

Then click on `Dasbhoards` on the left side of the screen

This should display a list of folders and reports on the middle of the screen.
Find the `CLAMM Bots` folder and click it

Then click on the `Bot Overview` report.

This will display a dashboard with some stats that we get from the bot's transactions.

To see the stats of your bot, copy your bot's address and paste it into the `Bot Address` box at the top of the screen. Then click `Enter` on your keyboard and the report will refresh and load your bot's stats.

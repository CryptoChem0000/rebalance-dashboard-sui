#!/bin/bash

# Script to create GitHub repository for rebalance-dashboard-sui
# Owner: cryptochem0000
# Repo: rebalance-dashboard-sui

echo "Creating GitHub repository: cryptochem0000/rebalance-dashboard-sui"

# Check if GitHub CLI is authenticated
if ! gh auth status &>/dev/null; then
    echo "Error: GitHub CLI is not authenticated."
    echo "Please run: gh auth login"
    exit 1
fi

# Create the repository
gh repo create cryptochem0000/rebalance-dashboard-sui \
    --public \
    --description "Real-time monitoring dashboard for Bolt liquidity pools on Sui" \
    --source=. \
    --remote=origin \
    --push

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Repository created successfully!"
    echo "📍 URL: https://github.com/cryptochem0000/rebalance-dashboard-sui"
else
    echo ""
    echo "❌ Failed to create repository."
    echo "You may need to:"
    echo "1. Authenticate: gh auth login"
    echo "2. Check permissions for cryptochem0000 organization"
    echo "3. Create repository manually via GitHub web interface"
    echo ""
    echo "See GITHUB-SETUP.md for manual setup instructions"
fi

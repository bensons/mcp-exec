#!/bin/bash
set -e

# Update system packages
sudo apt-get update

# Install Node.js 18+ (required by the project)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node.js and npm installation
node --version
npm --version

# Navigate to the workspace
cd /mnt/persist/workspace

# Install project dependencies
npm install

# Add npm global bin to PATH in user profile
echo 'export PATH="$PATH:$(npm config get prefix)/bin"' >> $HOME/.profile

# Source the profile to make PATH available immediately
source $HOME/.profile
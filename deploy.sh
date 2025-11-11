#!/bin/bash
set -e

echo "Starting deployment..."

cd /var/www/sky-city-pdf-generator

# Pull latest changes
echo "Pulling latest changes..."
git pull origin main

# Clean install to avoid corrupted node_modules
echo "Cleaning node_modules and package-lock..."
rm -rf node_modules
rm -f package-lock.json

# Clear npm cache to avoid corrupted packages
echo "Clearing npm cache..."
npm cache clean --force

# Install all dependencies (including dev dependencies needed for build)
echo "Installing dependencies..."
npm install

# Verify next is installed
if [ ! -f "node_modules/.bin/next" ]; then
  echo "Error: Next.js not properly installed!"
  exit 1
fi

# Build the application
echo "Building Next.js application..."
npm run build

# Verify build exists
if [ ! -d ".next" ]; then
  echo "Error: Build failed - .next directory not found!"
  exit 1
fi

# Stop PM2 process before reloading to avoid "already in progress" error
echo "Stopping PM2 process..."
pm2 stop ecosystem.config.js || true

# Wait a moment for process to fully stop
sleep 3

# Start PM2
echo "Starting PM2..."
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

echo "Deployment completed successfully!"


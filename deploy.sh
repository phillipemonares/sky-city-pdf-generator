#!/bin/bash
set -e

echo "Starting deployment..."

cd /var/www/sky-city-pdf-generator

# Pull latest changes
git pull origin main

# Install all dependencies (including dev dependencies needed for build)
npm ci

# Build the application
echo "Building Next.js application..."
npm run build

# Verify build exists
if [ ! -d ".next" ]; then
  echo "Error: Build failed - .next directory not found!"
  exit 1
fi

# Reload PM2
echo "Reloading PM2..."
pm2 reload ecosystem.config.js

# Save PM2 process list
pm2 save

echo "Deployment completed successfully!"


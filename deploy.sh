#!/bin/bash
set -e

echo "Starting deployment..."

cd /var/www/sky-city-pdf-generator

# Pull latest changes
git pull origin main

# Install dependencies
npm ci --production

# Build the application
npm run build

# Reload PM2
pm2 reload ecosystem.config.js

# Save PM2 process list
pm2 save

echo "Deployment completed successfully!"


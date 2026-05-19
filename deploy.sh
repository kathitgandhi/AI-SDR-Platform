#!/bin/bash
set -e

echo "🚀 Deploying AI SDR Platform..."

# Pull latest code
git pull origin main

# Build and restart all containers
docker compose build --no-cache
docker compose down
docker compose up -d

# Wait for API to be healthy
echo "⏳ Waiting for API to be healthy..."
for i in {1..30}; do
  if curl -sf http://localhost:3000/health > /dev/null; then
    echo "✅ API is healthy"
    break
  fi
  sleep 2
done

# Show running containers
docker compose ps

echo "✅ Deployment complete!"
echo "API: http://$(curl -s ifconfig.me):3000"

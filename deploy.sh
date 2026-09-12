#!/bin/bash
set -e

cd /home/riley-drake/Projects/Websites/Weather-Dashboard

echo "Fetching latest changes..."
git fetch origin

echo "Resetting to origin/main..."
git reset --hard origin/main

echo "Installing dependencies..."
npm ci

echo "Building weather dashboard..."
npm run build

echo "Weather deployment complete."

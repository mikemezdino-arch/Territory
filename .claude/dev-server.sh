#!/usr/bin/env bash
export PATH="/home/oem/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(dirname "$0")/.."
exec npm run dev

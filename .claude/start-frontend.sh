#!/bin/bash
export PATH="/Users/ziway/.nvm/versions/node/v22.16.0/bin:$PATH"
cd /Users/ziway/Downloads/工程项目/智阶新版
exec npx vite --host --port ${PORT:-5173}

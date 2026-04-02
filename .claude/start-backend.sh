#!/bin/bash
cd /Users/ziway/Downloads/工程项目/智阶新版/backend
export PYTHONPATH=.
exec .venv/bin/uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port ${PORT:-8000}

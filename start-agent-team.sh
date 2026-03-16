#!/bin/bash
# 智阶新版 Agent Team 一键启动脚本
# 使用方法：在终端中运行 bash start-agent-team.sh

cd "$(dirname "$0")"
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

claude --dangerously-skip-permissions -p "$(cat .claude/team-prompt.md)"

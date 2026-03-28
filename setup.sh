#!/bin/bash
set -e

echo "=== Marketing Team Setup ==="

# Create directory structure
mkdir -p tasks/output
mkdir -p tasks/agents

# Copy brief template if brief.md doesn't exist
if [ ! -f tasks/brief.md ]; then
  if [ -f tasks/brief_template.md ]; then
    cp tasks/brief_template.md tasks/brief.md
    echo "Created tasks/brief.md from template"
    echo "  -> Edit tasks/brief.md with your client information before running agents"
  else
    echo "Warning: tasks/brief_template.md not found"
  fi
else
  echo "tasks/brief.md already exists, skipping copy"
fi

echo ""
echo "Setup complete. Next steps:"
echo "  1. Edit tasks/brief.md with client information"
echo "  2. Run: claude"
echo "     Prompt: @tasks/brief.md を読んで、@CLAUDE.md のワークフローに従って全エージェントを動かして。アウトプットは tasks/output/ に保存して。"

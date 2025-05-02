#!/bin/bash

# Ollama Docker management script for FixLang MVP
# Focused on deepseek-r1:7b model for simplicity
# Usage: ./ollama.sh [start|stop|status|pull|run PROMPT]

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

function check_docker() {
  if ! command -v docker &> /dev/null || ! command -v docker-compose &> /dev/null; then
    echo "⛔ Error: Docker and/or docker-compose are not installed."
    echo "Please install Docker Desktop for Mac from https://www.docker.com/products/docker-desktop/"
    exit 1
  fi
}

function start_container() {
  echo "🚀 Starting Ollama container..."
  docker-compose up -d
  echo "⏳ Waiting for Ollama service to be ready..."

  # Wait for Ollama to be ready
  for i in {1..30}; do
    if curl -s http://localhost:11434/api/tags &> /dev/null; then
      echo "✅ Ollama is running!"
      return 0
    fi
    echo -n "."
    sleep 1
  done

  echo "⛔ Ollama failed to start in time."
  return 1
}

function stop_container() {
  echo "🛑 Stopping Ollama container..."
  docker-compose down
  echo "✅ Ollama stopped."
}

function check_status() {
  if curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo "✅ Ollama service is running."

    # Get list of models
    echo "📋 Available models:"
    curl -s http://localhost:11434/api/tags | jq '.models[] | .name'

    return 0
  else
    echo "❌ Ollama service is not running."
    return 1
  fi
}

function pull_model() {
  # For MVP, we're only using deepseek-r1:7b
  local MODEL="deepseek-r1:7b"

  echo "📥 Pulling model: $MODEL (MVP test model)"
  echo "⏳ This might take a while to download (approximately 7.5 GB)..."

  # Check if model is already pulled
  if curl -s http://localhost:11434/api/tags | grep -q "$MODEL"; then
    echo "✅ Model $MODEL is already pulled. Ready to use."
    return 0
  fi

  # Pull the model
  curl -X POST http://localhost:11434/api/pull -d "{\"name\":\"$MODEL\"}"
  echo -e "\n✅ Model pulled successfully."
}

function run_model() {
  # For MVP, we're only using deepseek-r1:7b
  local MODEL="deepseek-r1:7b"
  local PROMPT=$1

  if [ -z "$PROMPT" ]; then
    echo "⛔ Error: Prompt is required."
    echo "Usage: ./ollama.sh run \"Your prompt here\""
    return 1
  fi

  # Check if model exists
  if ! curl -s http://localhost:11434/api/tags | grep -q "$MODEL"; then
    echo "⚠️ Model $MODEL is not pulled yet. Pulling now..."
    pull_model
  fi

  echo "🧠 Running deepseek-r1:7b model with your prompt"
  curl -X POST http://localhost:11434/api/generate -d "{\"model\":\"$MODEL\",\"prompt\":\"$PROMPT\"}"
  echo -e "\n✅ Done."
}

# Main script logic
check_docker

case "$1" in
  start)
    start_container
    ;;
  stop)
    stop_container
    ;;
  status)
    check_status
    ;;
  pull)
    # For MVP, we're only using deepseek-r1:7b, so no model name parameter needed
    pull_model
    ;;
  run)
    # For MVP, we're only using deepseek-r1:7b, so no model name parameter needed
    run_model "$2"
    ;;
  *)
    echo "Usage: ./ollama.sh [start|stop|status|pull|run PROMPT]"
    echo "  start  - Start the Ollama container"
    echo "  stop   - Stop the Ollama container"
    echo "  status - Check if Ollama is running and list available models"
    echo "  pull   - Pull the deepseek-r1:7b model (MVP default)"
    echo "  run    - Run a query with deepseek-r1:7b (e.g., ./ollama.sh run \"Write a hello world in Python\")"
    echo ""
    echo "Note: This script is configured specifically for the FixLang MVP with deepseek-r1:7b model."
    exit 1
    ;;
esac

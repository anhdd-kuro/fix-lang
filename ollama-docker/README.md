# Ollama Docker Setup for FixLang - MVP

This directory contains everything needed to run Ollama in Docker for the FixLang MVP using only the deepseek-r1:7b model.

## Prerequisites

- Docker Desktop for Mac installed (from [Docker's website](https://www.docker.com/products/docker-desktop/))
- At least 16GB of disk space for the model and Docker
- At least 8GB of RAM allocated to Docker

## Quick Start

1. Start the Ollama container:

   ```bash
   ./ollama.sh start
   ```

2. Pull the deepseek-r1:7b model:

   ```bash
   ./ollama.sh pull deepseek-r1:7b
   ```

3. Check status to verify model installation:

   ```bash
   ./ollama.sh status
   ```

4. Run your FixLang application - it should now detect the local model

## Available Commands

- `./ollama.sh start` - Start the Ollama container
- `./ollama.sh stop` - Stop the Ollama container
- `./ollama.sh status` - Check if Ollama is running and list models
- `./ollama.sh pull deepseek-r1:7b` - Pull the model required for the MVP
- `./ollama.sh run deepseek-r1:7b "Your prompt here"` - Test the model with a prompt

## Model Information

The MVP uses only the deepseek-r1:7b model:

- Size: approximately 7.5GB
- Capabilities: General-purpose reasoning, text generation, and coding
- Requirements: 8GB RAM recommended, 16GB disk space

## Troubleshooting

If you see "No local models found or Ollama is not running" in FixLang:

1. Run `./ollama.sh status` to check if Ollama is running
2. Confirm Docker has enough resources allocated
3. Verify the deepseek-r1:7b model is pulled correctly

If the model is slow or causes crashes:

1. Increase Docker's RAM allocation in Docker Desktop settings
2. Restart Docker and the Ollama container

## Integration with FixLang

The FixLang app is configured to look for Ollama on `http://localhost:11434` (the default port forwarded from the Docker container).

No additional configuration is needed - just start the Docker container and pull the model before launching FixLang.

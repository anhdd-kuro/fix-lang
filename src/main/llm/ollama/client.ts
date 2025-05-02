import { Ollama } from "ollama";

export const ollamaClient = new Ollama({ host: "http://localhost:11434" });

import type { ProviderApi } from "./types";

export interface ProviderPreset {
  id: string;
  displayName: string;
  baseUrl: string;
  api: ProviderApi;
  websiteUrl: string;
  apiKeyUrl: string | null;
  defaultModels: string[];
  requiresKey: boolean;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-completions",
    websiteUrl: "https://openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    defaultModels: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini"],
    requiresKey: true,
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    api: "anthropic-messages",
    websiteUrl: "https://anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    defaultModels: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    requiresKey: true,
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    api: "openai-completions",
    websiteUrl: "https://deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    defaultModels: ["deepseek-chat", "deepseek-coder"],
    requiresKey: true,
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    defaultModels: ["auto"],
    requiresKey: true,
  },
  {
    id: "groq",
    displayName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    api: "openai-completions",
    websiteUrl: "https://groq.com",
    apiKeyUrl: "https://console.groq.com/keys",
    defaultModels: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    requiresKey: true,
  },
  {
    id: "moonshot",
    displayName: "Moonshot AI",
    baseUrl: "https://api.moonshot.cn/v1",
    api: "openai-completions",
    websiteUrl: "https://moonshot.cn",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    defaultModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    requiresKey: true,
  },
  {
    id: "zhipu",
    displayName: "Zhipu AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    api: "openai-completions",
    websiteUrl: "https://bigmodel.cn",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    defaultModels: ["glm-4", "glm-4-plus"],
    requiresKey: true,
  },
  {
    id: "ollama",
    displayName: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    api: "openai-completions",
    websiteUrl: "https://ollama.com",
    apiKeyUrl: null,
    defaultModels: ["llama3.3", "qwen2.5"],
    requiresKey: false,
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    api: "openai-completions",
    websiteUrl: "https://lmstudio.ai",
    apiKeyUrl: null,
    defaultModels: [],
    requiresKey: false,
  },
  {
    id: "google",
    displayName: "Google AI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    api: "openai-completions",
    websiteUrl: "https://ai.google.dev",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    defaultModels: ["gemini-2.0-flash-exp", "gemini-1.5-pro"],
    requiresKey: true,
  },
  {
    id: "custom",
    displayName: "Custom",
    baseUrl: "",
    api: "openai-completions",
    websiteUrl: "",
    apiKeyUrl: null,
    defaultModels: [],
    requiresKey: false,
  },
] as const;

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

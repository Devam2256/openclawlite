import { createOpenRouter } from "@openrouter/ai-sdk-provider";

function stripQuotes(v?: string) {
  if (!v) return v;
  return v.replace(/^\s*["']|["']\s*$/g, "");
}

export const config = {
  apiKey: stripQuotes(process.env.OPENROUTER_API_KEY),
  defaultModel: stripQuotes(process.env.OPENROUTER_DEFAULT_MODEL) || "anthropic/claude-3.5-sonnet",
  baseURL: "https://openrouter.ai/api/v1"
};

export function getAgentModel() {
    const apiKey = config.apiKey;
    const defaultModel = config.defaultModel;

    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY environment variable is not set");
    }
    if (!defaultModel) {
        throw new Error("OPENROUTER_DEFAULT_MODEL environment variable is not set");
    }

    const provider = createOpenRouter({ apiKey });
    return provider(defaultModel);
}

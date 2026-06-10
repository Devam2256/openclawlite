import { config } from "./ai.config.ts";

export { getAgentModel } from "./ai.config.ts";

const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function askClaude(prompt: string, systemPrompt?: string): Promise<string> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const body = JSON.stringify({ model: config.defaultModel, messages });

  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`
        },
        body
      });

      if (!response.ok) {
        const errorText = await response.text();
        // 429 / 5xx are retryable; 4xx auth errors are not
        const status = response.status;
        const retryable = status === 429 || status >= 500;
        if (!retryable) {
          throw new Error(`OpenRouter API error ${status}: ${errorText}`);
        }
        throw new Error(`OpenRouter retryable error ${status}: ${errorText}`);
      }

      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (typeof content !== "string") {
        throw new Error(`Unexpected response format: ${JSON.stringify(data).slice(0, 200)}`);
      }

      return content.trim();
    } catch (err: any) {
      lastError = err;
      const isRetryable =
        err?.code === "ECONNRESET" ||
        err?.code === "ECONNREFUSED" ||
        err?.code === "ETIMEDOUT" ||
        err?.message?.includes("retryable") ||
        err?.message?.includes("socket");

      if (!isRetryable || attempt === RETRY_DELAYS_MS.length) {
        console.error(`askClaude failed after ${attempt + 1} attempt(s):`, err?.message ?? err);
        throw err;
      }

      const delay = RETRY_DELAYS_MS[attempt]!;
      console.warn(`askClaude attempt ${attempt + 1} failed (${err?.code ?? err?.message}), retrying in ${delay}ms…`);
      await sleep(delay);
    }
  }

  throw lastError;
}

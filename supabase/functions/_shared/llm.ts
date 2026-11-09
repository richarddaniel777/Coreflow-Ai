type Provider = "groq" | "openai";
type ProviderReason = "OVERLOADED" | "RATE_LIMITED" | "CONFIG_ERROR" | "INVALID_OUTPUT";
type ProviderEntry = { provider: Provider; model: string; apiKey: string };
type GeneratedText = { text: string; provider: Provider; model: string };

export class LlmRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: "rate_limit" | "configuration" | "analysis" | "provider",
    public retryAfter?: number,
    public providerReason?: ProviderReason,
    public providerName?: string,
  ) {
    super(message);
    this.name = "LlmRequestError";
  }
}

function cleanSecret(value: string | undefined): string {
  return (value || "").replace(/[\x00-\x1F\x7F-\x9F\uFEFF]/g, "").trim();
}

function readSecret(name: string): string {
  return cleanSecret(Deno.env.get(name));
}

function keyFor(provider: string): string | null {
  if (provider === "groq") return readSecret("GROQ_API_KEY") || null;
  if (provider === "openai") return readSecret("OPENAI_API_KEY") || null;
  return null;
}

function logAttempt(status: number | string, attempt: number, provider: string, model: string, startedAt: number): void {
  console.error(JSON.stringify({ status, attempt, provider, model, duration_ms: Math.round(performance.now() - startedAt) }));
}

function parseChain(): { entries: ProviderEntry[]; configuredNames: Array<{ provider: string; model: string }> } {
  const chain = readSecret("LLM_CHAIN");
  const configuredNames: Array<{ provider: string; model: string }> = [];
  const entries: ProviderEntry[] = [];
  for (const rawPart of chain.split(",")) {
    const item = cleanSecret(rawPart);
    const separator = item.indexOf(":");
    if (separator <= 0 || separator === item.length - 1) continue;
    const provider = cleanSecret(item.slice(0, separator)).toLowerCase();
    const model = cleanSecret(item.slice(separator + 1));
    if (!provider || !model) continue;
    configuredNames.push({ provider, model });
    const apiKey = keyFor(provider);
    if (!apiKey) {
      logAttempt("SKIPPED_MISSING_KEY", 0, provider, model, performance.now());
      continue;
    }
    if (provider !== "groq" && provider !== "openai") {
      logAttempt("SKIPPED_UNSUPPORTED_PROVIDER", 0, provider, model, performance.now());
      continue;
    }
    entries.push({ provider, model, apiKey });
  }
  return { entries, configuredNames };
}

function configurationError(provider: string, status = 503): LlmRequestError {
  return new LlmRequestError(
    `The ${provider} provider rejected its configuration. Check the provider model and secret.`,
    status,
    "configuration",
    undefined,
    "CONFIG_ERROR",
    provider,
  );
}

function overloadedError(provider: string): LlmRequestError {
  return new LlmRequestError(
    "The AI service is busy right now. Please try again in a minute.",
    503,
    "provider",
    60,
    "OVERLOADED",
    provider,
  );
}

function rateLimitedError(provider: string, retryAfter: number): LlmRequestError {
  return new LlmRequestError(
    "The AI service is busy right now. Please try again in a minute.",
    429,
    "rate_limit",
    retryAfter,
    "RATE_LIMITED",
    provider,
  );
}

function invalidOutputError(provider: string): LlmRequestError {
  return new LlmRequestError(
    "The AI provider returned an incomplete analysis. Please try again.",
    502,
    "analysis",
    undefined,
    "INVALID_OUTPUT",
    provider,
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 500 || status === 503 || status === 504;
}

function retryAfterSeconds(response: Response): number {
  const header = response.headers.get("retry-after");
  if (!header) return 60;
  if (/^\d+(?:\.\d+)?$/.test(header.trim())) return Math.min(3600, Math.max(0, Math.ceil(Number(header))));
  const retryAt = Date.parse(header);
  return Number.isFinite(retryAt) && retryAt > Date.now()
    ? Math.min(3600, Math.ceil((retryAt - Date.now()) / 1000))
    : 60;
}

async function withinBudget<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new LlmRequestError("AI provider request timed out.", 502, "provider");
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new LlmRequestError("AI provider request timed out.", 502, "provider")), remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

async function makeRequest(
  entry: ProviderEntry,
  systemPrompt: string,
  userContent: string,
  deadline: number,
  attemptState: { value: number },
  includeReasoningEffort: boolean,
): Promise<Response> {
  const remainingMs = Math.floor(deadline - performance.now());
  if (remainingMs <= 0) throw overloadedError(entry.provider);
  const controller = new AbortController();
  const startedAt = performance.now();
  const attempt = ++attemptState.value;
  const timeout = setTimeout(() => controller.abort(), Math.min(5_000, remainingMs));
  const isGroq = entry.provider === "groq";
  const requestBody: Record<string, unknown> = {
    model: entry.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 4096,
  };
  const supportsReasoningEffort = isGroq && /(?:^|\/)openai\/gpt-oss-/i.test(entry.model);
  if (supportsReasoningEffort && includeReasoningEffort) requestBody.reasoning_effort = "low";
  const baseUrl = isGroq ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";
  try {
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${entry.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
    logAttempt(response.status, attempt, entry.provider, entry.model, startedAt);
    if (response.status === 400 && supportsReasoningEffort && includeReasoningEffort) {
      clearTimeout(timeout);
      return await makeRequest(entry, systemPrompt, userContent, deadline, attemptState, false);
    }
    return response;
  } catch (error) {
    logAttempt(0, attempt, entry.provider, entry.model, startedAt);
    if (error instanceof LlmRequestError) throw error;
    throw overloadedError(entry.provider);
  } finally {
    clearTimeout(timeout);
  }
}

async function retryAfterResponse(response: Response, remaining: () => number): Promise<number> {
  const header = response.headers.get("retry-after");
  if (header) return retryAfterSeconds(response);
  try {
    const payload = await withinBudget(response.clone().json(), remaining());
    const retryInfo = payload.error?.details?.find((detail: { "@type"?: string }) => detail["@type"]?.includes("RetryInfo"));
    const match = typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
    return match ? Math.min(3600, Math.ceil(Number(match[1]))) : 60;
  } catch {
    return 60;
  }
}

async function requestEntry(
  entry: ProviderEntry,
  systemPrompt: string,
  userContent: string,
  deadline: number,
  attemptState: { value: number },
): Promise<Response> {
  let overloadRetries = 0;
  let rateLimitRetries = 0;
  while (true) {
    const response = await makeRequest(entry, systemPrompt, userContent, deadline, attemptState, true);
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw configurationError(entry.provider, response.status);
    }
    if (isRetryableStatus(response.status)) {
      if (overloadRetries >= 2) throw overloadedError(entry.provider);
      const delay = (overloadRetries === 0 ? 1_000 : 3_000) + Math.floor(Math.random() * 251);
      if (deadline - performance.now() <= delay + 250) throw overloadedError(entry.provider);
      await new Promise((resolve) => setTimeout(resolve, delay));
      overloadRetries++;
      continue;
    }
    if (response.status === 429) {
      const retryAfter = await retryAfterResponse(response, () => deadline - performance.now());
      const delay = retryAfter * 1_000;
      if (rateLimitRetries >= 1 || deadline - performance.now() <= delay + 250) {
        throw rateLimitedError(entry.provider, retryAfter);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      rateLimitRetries++;
      continue;
    }
    if (!response.ok) throw configurationError(entry.provider, response.status);
    return response;
  }
}

function parseChatResponse(payload: any, provider: Provider): string {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason === "length" || typeof content !== "string" || !content.trim()) {
    throw invalidOutputError(provider);
  }
  return content.trim();
}

export async function generateText(
  systemPrompt: string,
  userContent: string,
  deadline = performance.now() + 24_000,
): Promise<GeneratedText> {
  const { entries, configuredNames } = parseChain();
  if (entries.length === 0) {
    const listed = configuredNames.map((entry) => `${entry.provider}:${entry.model}`).join(", ");
    throw new LlmRequestError(
      listed ? `No configured provider key is available for LLM_CHAIN entries: ${listed}.` : "Set LLM_CHAIN and the matching provider secret to enable AI scoring.",
      503,
      "configuration",
      undefined,
      "CONFIG_ERROR",
      configuredNames[0]?.provider || "llm_chain",
    );
  }

  const attemptState = { value: 0 };
  let lastRetryable: LlmRequestError | null = null;
  for (const entry of entries) {
    try {
      const response = await requestEntry(entry, systemPrompt, userContent, deadline, attemptState);
      let payload: unknown;
      try {
        payload = await withinBudget(response.json(), deadline - performance.now());
      } catch (error) {
        if (error instanceof LlmRequestError) throw error;
        throw invalidOutputError(entry.provider);
      }
      const text = parseChatResponse(payload, entry.provider);
      return { text, provider: entry.provider, model: entry.model };
    } catch (error) {
      if (error instanceof LlmRequestError && (error.providerReason === "OVERLOADED" || error.providerReason === "RATE_LIMITED")) {
        lastRetryable = error;
        if (deadline - performance.now() > 250) continue;
        break;
      }
      throw error;
    }
  }
  throw lastRetryable || overloadedError(entries[entries.length - 1].provider);
}

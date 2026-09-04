import { ENV } from "./env";

/**
 * AIアシスト用のLLM呼び出し。
 * OpenAI Chat Completions APIをサーバーから直接呼び、既存の呼び出し側が
 * 依存する最小レスポンス形式へ正規化する。
 */

export type Role = "system" | "user" | "assistant";

export type Message = {
  role: Role;
  content: string;
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

export type InvokeParams = {
  messages: Message[];
  maxTokens?: number;
  max_tokens?: number;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  model?: string;
};

export type InvokeResult = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type OpenAIError = Error & { status?: number };

function httpError(status: number): OpenAIError {
  const error = new Error(`OpenAI API request failed (${status})`) as OpenAIError;
  error.status = status;
  return error;
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  if (!ENV.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured — AI assist features are unavailable.");
  }

  const format = params.responseFormat ?? params.response_format;
  const responseFormat = !format || format.type === "text"
    ? undefined
    : format.type === "json_object"
      ? { type: "json_object" as const }
      : {
          type: "json_schema" as const,
          json_schema: {
            name: format.json_schema.name,
            schema: format.json_schema.schema,
            strict: format.json_schema.strict ?? true,
          },
        };

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model ?? ENV.openaiModel,
        messages: params.messages,
        max_completion_tokens: params.maxTokens ?? params.max_tokens ?? 2048,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error("OpenAI API request timeout");
    }
    throw error;
  }

  if (!response.ok) throw httpError(response.status);

  const data = await response.json() as {
    id?: string;
    model?: string;
    choices?: Array<{
      index?: number;
      message?: { content?: string | null };
      finish_reason?: string | null;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  return {
    id: data.id ?? "",
    model: data.model ?? (params.model ?? ENV.openaiModel),
    choices: (data.choices ?? []).map((choice, index) => ({
      index: choice.index ?? index,
      message: { role: "assistant", content: choice.message?.content ?? "" },
      finish_reason: choice.finish_reason ?? null,
    })),
    usage: data.usage ? {
      prompt_tokens: data.usage.prompt_tokens ?? 0,
      completion_tokens: data.usage.completion_tokens ?? 0,
      total_tokens: data.usage.total_tokens ?? 0,
    } : undefined,
  };
}

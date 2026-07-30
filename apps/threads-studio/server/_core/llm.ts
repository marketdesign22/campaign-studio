import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";

/**
 * AIアシスト用のLLM呼び出し（スタンドアロン版）。
 * Anthropic API を直接呼ぶ。呼び出し側（server/routers/ai.ts）が使う
 * OpenAI互換の最小サブセット — system/userメッセージ・maxTokens・
 * responseFormat(json) — のみをサポートし、返り値も同じ形に揃える。
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

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!ENV.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured — AI assist features are unavailable."
    );
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: ENV.anthropicApiKey });
  }
  return _client;
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const client = getClient();

  const system = params.messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n\n");
  const messages = params.messages
    .filter((m): m is Message & { role: "user" | "assistant" } => m.role !== "system")
    .map(m => ({ role: m.role, content: m.content }));

  const format = params.responseFormat ?? params.response_format;
  const maxTokens = params.maxTokens ?? params.max_tokens ?? 2048;

  const response = await client.messages.create({
    model: params.model ?? ENV.anthropicModel,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages,
    ...(format && format.type === "json_schema"
      ? {
          output_config: {
            format: {
              type: "json_schema" as const,
              schema: format.json_schema.schema,
            },
          },
        }
      : {}),
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("");

  return {
    id: response.id,
    model: response.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: response.stop_reason,
      },
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

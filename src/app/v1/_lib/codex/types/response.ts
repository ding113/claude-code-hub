/**
 * OpenAI Response API (/v1/responses) 类型定义
 */

// ============ 请求类型 ============

export interface ResponseRequest {
  model: string;
  input: InputItem[];
  // 可选参数（参考 litellm ResponsesAPIOptionalRequestParams）
  instructions?: string;
  max_output_tokens?: number;
  metadata?: Record<string, string>;
  parallel_tool_calls?: boolean;
  previous_response_id?: string;
  reasoning?: ReasoningConfig;
  prompt_cache_key?: string;
  generate?: boolean;
  store?: boolean;
  stream?: boolean;
  temperature?: number;
  tool_choice?: string | ToolChoiceObject;
  tools?: ResponseTool[];
  top_p?: number;
  truncation?: "auto" | "disabled";
  user?: string;
  service_tier?: string;
}

export interface ReasoningConfig {
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  summary?: "auto" | "concise" | "detailed";
  encrypted_content?: string;
  [key: string]: unknown;
}

export interface ToolChoiceObject {
  type: "function";
  function?: {
    name: string;
  };
}

export interface ResponseTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type InputItem = MessageInput | ToolOutputsInput;

export interface MessageInput {
  role: "user" | "assistant" | "developer";
  content: ContentItem[];
}

export interface ToolOutputsInput {
  type: "tool_outputs";
  outputs: ToolOutput[];
}

export interface ToolOutput {
  call_id: string;
  output: string;
}

export type ContentItem = TextContent | ImageContent;

export interface TextContent {
  type: "input_text" | "output_text";
  text: string;
}

export interface ImageContent {
  type: "input_image";
  image_url: string;
}

// ============ 响应类型（非流式）============

export interface ResponseObject {
  id: string;
  object: "response";
  created: number;
  model: string;
  status: "completed" | "failed" | "incomplete";
  output: OutputItem[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
    total_tokens: number;
  };
  service_tier?: string;
}

export type OutputItem = ReasoningOutput | MessageOutput | ToolCallsOutput;

export interface ReasoningOutput {
  id: string;
  type: "reasoning";
  summary?: SummaryText[];
}

export interface MessageOutput {
  id: string;
  type: "message";
  role: "assistant";
  status: "completed";
  content: OutputContent[];
}

export interface ToolCallsOutput {
  id: string;
  type: "tool_calls";
  tool_calls: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OutputContent {
  type: "output_text";
  text: string;
  annotations?: unknown[];
  logprobs?: unknown[];
}

export interface SummaryText {
  type: "summary_text";
  text: string;
}

// ============ SSE 事件类型 ============

export type SSEEventType =
  | "response.created"
  | "response.output_text.delta"
  | "response.reasoning_summary_text.delta"
  | "response.reasoning_summary_text.done"
  | "response.reasoning_summary_part.done"
  | "response.completed"
  | "response.failed"
  | "error";

export interface SSEEvent {
  event: SSEEventType;
  data: unknown;
}

export interface ResponseCreatedEvent {
  id: string;
  object: "response";
  created: number;
  model: string;
  status: "generating";
}

export interface OutputTextDeltaEvent {
  type: "response.output_text.delta";
  item_id: string;
  delta: string;
}

export interface ReasoningSummaryTextDeltaEvent {
  type: "response.reasoning_summary_text.delta";
  item_id: string;
  delta: string;
  output_index: number;
  summary_index: number;
  sequence_number: number;
  obfuscation?: string;
}

export interface ReasoningSummaryTextDoneEvent {
  type: "response.reasoning_summary_text.done";
  item_id: string;
  text: string;
  output_index: number;
  summary_index: number;
  sequence_number: number;
}

export interface ReasoningSummaryPartDoneEvent {
  type: "response.reasoning_summary_part.done";
  item_id: string;
  part: SummaryText;
  output_index: number;
  summary_index: number;
  sequence_number: number;
}

export interface ResponseCompletedEvent {
  id: string;
  object: "response";
  created: number;
  model: string;
  status: "completed";
  output: OutputItem[];
  usage: ResponseObject["usage"];
}

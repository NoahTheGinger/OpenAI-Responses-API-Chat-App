export type ChatRole = 'user' | 'assistant';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export type ToolType =
  | 'mcp'
  | 'function'
  | 'file_search'
  | 'web_search'
  | 'code_interpreter'
  | 'image_generation'
  | 'custom';

export interface ToolConfigBase {
  id: string;
  type: ToolType;
}

export interface FunctionToolConfig extends ToolConfigBase {
  type: 'function';
  name: string;
  description: string;
  parameters: string;
  strict: boolean;
}

export interface FileSearchToolConfig extends ToolConfigBase {
  type: 'file_search';
  vectorStoreIds: string;
  maxResults: string;
  scoreThreshold: string;
  ranker: 'auto' | 'default-2024-11-15';
}

export interface WebSearchToolConfig extends ToolConfigBase {
  type: 'web_search';
  mode: 'web_search' | 'web_search_2025_08_26';
  allowedDomains: string;
  searchContextSize: 'low' | 'medium' | 'high';
  userLocation: {
    city: string;
    country: string;
    region: string;
    timezone: string;
  };
}

export interface CodeInterpreterToolConfig extends ToolConfigBase {
  type: 'code_interpreter';
  fileIds: string;
}

export interface ImageGenerationToolConfig extends ToolConfigBase {
  type: 'image_generation';
  model: 'gpt-image-1';
  size: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  quality: 'low' | 'medium' | 'high' | 'auto';
  background: 'transparent' | 'opaque' | 'auto';
  outputFormat: 'png' | 'webp' | 'jpeg';
  moderation: 'auto' | 'low';
  inputFidelity: '' | 'low' | 'high';
  partialImages: string;
  outputCompression: string;
}

export interface McpToolConfig extends ToolConfigBase {
  type: 'mcp';
  serverLabel: string;
  serverUrl: string;
  connectorId:
    | ''
    | 'connector_dropbox'
    | 'connector_gmail'
    | 'connector_googlecalendar'
    | 'connector_googledrive'
    | 'connector_microsoftteams'
    | 'connector_outlookcalendar'
    | 'connector_outlookemail'
    | 'connector_sharepoint';
  allowedToolNames: string;
  readOnly: boolean;
  requireApproval: 'never' | 'always' | 'read_only';
  serverDescription: string;
  authorization: string;
}

export interface CustomToolConfig extends ToolConfigBase {
  type: 'custom';
  name: string;
  description: string;
  formatType: 'text' | 'grammar';
  grammarDefinition: string;
  grammarSyntax: 'lark' | 'regex';
}

export type ToolConfig =
  | FunctionToolConfig
  | FileSearchToolConfig
  | WebSearchToolConfig
  | CodeInterpreterToolConfig
  | ImageGenerationToolConfig
  | McpToolConfig
  | CustomToolConfig;

export type ToolChoiceState =
  | { mode: 'auto' | 'none' | 'required' }
  | { mode: 'function'; name: string }
  | { mode: 'mcp'; serverLabel: string; toolName?: string }
  | { mode: 'custom'; name: string };

export interface ToolSummary {
  id: string;
  title: string;
  details: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  toolSummaries?: ToolSummary[];
}

export interface ConversationState {
  messages: ChatMessage[];
  systemPrompt: string;
  model: string;
  temperature: number;
  reasoningEffort: ReasoningEffort | null;
  lastResponseId: string | null;
  tools: ToolConfig[];
  toolChoice: ToolChoiceState;
  parallelToolCalls: boolean;
  maxOutputTokens: number | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

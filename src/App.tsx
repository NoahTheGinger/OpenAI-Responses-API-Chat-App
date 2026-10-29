import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ConversationState,
  ReasoningEffort,
  TokenUsage,
  ToolChoiceState,
  ToolConfig,
  McpToolConfig,
  ToolSummary,
  ToolType
} from './types';
import './App.css';

const STORAGE_KEY = 'openai-chat-playground-state';
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

const MODEL_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'GPT-5', value: 'gpt-5' },
  { label: 'GPT-4.1', value: 'gpt-4.1' },
  { label: 'GPT-4o mini', value: 'gpt-4o-mini' }
];

const REASONING_OPTIONS: Array<{ label: string; value: ReasoningEffort | null }> = [
  { label: 'Model default', value: null },
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' }
];

const TOOL_TYPE_LABELS: Record<ToolType, string> = {
  mcp: 'MCP Server',
  function: 'Function',
  file_search: 'File Search',
  web_search: 'Web Search',
  code_interpreter: 'Code Interpreter',
  image_generation: 'Image Generation',
  custom: 'Custom'
};

const CONNECTOR_OPTIONS: Array<{ label: string; value: McpToolConfig['connectorId'] }> = [
  { label: 'None (custom server URL)', value: '' },
  { label: 'Dropbox', value: 'connector_dropbox' },
  { label: 'Gmail', value: 'connector_gmail' },
  { label: 'Google Calendar', value: 'connector_googlecalendar' },
  { label: 'Google Drive', value: 'connector_googledrive' },
  { label: 'Microsoft Teams', value: 'connector_microsoftteams' },
  { label: 'Outlook Calendar', value: 'connector_outlookcalendar' },
  { label: 'Outlook Email', value: 'connector_outlookemail' },
  { label: 'SharePoint', value: 'connector_sharepoint' }
];

const TOOL_CHOICE_OPTIONS: Array<{ label: string; value: ToolChoiceState['mode'] }> = [
  { label: 'Let the model decide', value: 'auto' },
  { label: 'Never call tools', value: 'none' },
  { label: 'Require a tool call', value: 'required' },
  { label: 'Force a function', value: 'function' },
  { label: 'Force an MCP tool', value: 'mcp' },
  { label: 'Force a custom tool', value: 'custom' }
];

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const toTokenUsage = (usage: unknown): TokenUsage | null => {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const {
    input_tokens,
    output_tokens,
    total_tokens,
    input_tokens_details,
    output_tokens_details
  } = usage as Record<string, unknown>;

  if (
    typeof input_tokens !== 'number' &&
    typeof output_tokens !== 'number' &&
    typeof total_tokens !== 'number'
  ) {
    return null;
  }

  const cachedTokens =
    input_tokens_details &&
    typeof input_tokens_details === 'object' &&
    input_tokens_details !== null &&
    typeof (input_tokens_details as Record<string, unknown>).cached_tokens === 'number'
      ? ((input_tokens_details as Record<string, unknown>).cached_tokens as number)
      : undefined;

  const reasoningTokens =
    output_tokens_details &&
    typeof output_tokens_details === 'object' &&
    output_tokens_details !== null &&
    typeof (output_tokens_details as Record<string, unknown>).reasoning_tokens === 'number'
      ? ((output_tokens_details as Record<string, unknown>).reasoning_tokens as number)
      : undefined;

  return {
    inputTokens: typeof input_tokens === 'number' ? input_tokens : 0,
    outputTokens: typeof output_tokens === 'number' ? output_tokens : 0,
    totalTokens: typeof total_tokens === 'number' ? total_tokens : 0,
    cachedTokens,
    reasoningTokens
  };
};

const splitList = (value: string): string[] =>
  value
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const truncateText = (value: string, max = 1200): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const formatMaybeJson = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch (error) {
    return trimmed;
  }
};

const createToolConfig = (type: ToolType): ToolConfig => {
  const id = createId();
  switch (type) {
    case 'function':
      return {
        id,
        type,
        name: '',
        description: '',
        parameters: '{}',
        strict: true
      };
    case 'file_search':
      return {
        id,
        type,
        vectorStoreIds: '',
        maxResults: '',
        scoreThreshold: '',
        ranker: 'auto'
      };
    case 'web_search':
      return {
        id,
        type,
        mode: 'web_search',
        allowedDomains: '',
        searchContextSize: 'medium',
        userLocation: { city: '', country: '', region: '', timezone: '' }
      };
    case 'code_interpreter':
      return {
        id,
        type,
        fileIds: ''
      };
    case 'image_generation':
      return {
        id,
        type,
        model: 'gpt-image-1',
        size: 'auto',
        quality: 'auto',
        background: 'auto',
        outputFormat: 'png',
        moderation: 'auto',
        inputFidelity: '',
        partialImages: '',
        outputCompression: ''
      };
    case 'mcp':
      return {
        id,
        type,
        serverLabel: '',
        serverUrl: '',
        connectorId: '',
        allowedToolNames: '',
        readOnly: false,
        requireApproval: 'never',
        serverDescription: '',
        authorization: ''
      };
    case 'custom':
    default:
      return {
        id,
        type: 'custom',
        name: '',
        description: '',
        formatType: 'text',
        grammarDefinition: '',
        grammarSyntax: 'lark'
      };
  }
};

const restoreToolConfig = (raw: unknown): ToolConfig | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Partial<ToolConfig> & { type?: ToolType; id?: string };
  if (!candidate.type || !(candidate.type in TOOL_TYPE_LABELS)) {
    return null;
  }

  const template = createToolConfig(candidate.type);
  return {
    ...template,
    ...candidate,
    id: typeof candidate.id === 'string' ? candidate.id : template.id
  } as ToolConfig;
};

type ToolPreparationResult = {
  tool?: Record<string, unknown>;
  error?: string;
};

const prepareToolForRequest = (config: ToolConfig): ToolPreparationResult => {
  switch (config.type) {
    case 'function': {
      const name = config.name.trim();
      if (!name) {
        return { error: 'Function tools require a name.' };
      }

      const description = config.description.trim();
      let parameters: Record<string, unknown> | null = {};
      const rawParameters = config.parameters.trim();
      if (rawParameters) {
        try {
          const parsed = JSON.parse(rawParameters);
          if (parsed === null || typeof parsed !== 'object') {
            return { error: 'Function parameters must be a valid JSON object.' };
          }
          parameters = parsed as Record<string, unknown>;
        } catch (parseError) {
          return { error: 'Function parameters must be valid JSON.' };
        }
      }

      return {
        tool: {
          type: 'function',
          name,
          description: description || undefined,
          parameters,
          strict: config.strict
        }
      };
    }
    case 'file_search': {
      const vectorStoreIds = splitList(config.vectorStoreIds);
      if (vectorStoreIds.length === 0) {
        return { error: 'File search tools require at least one vector store ID.' };
      }

      const tool: Record<string, unknown> = {
        type: 'file_search',
        vector_store_ids: vectorStoreIds
      };

      if (config.maxResults.trim()) {
        const parsed = Number.parseInt(config.maxResults, 10);
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 50) {
          return { error: 'File search max results must be between 1 and 50.' };
        }
        tool.max_num_results = parsed;
      }

      const rankingOptions: Record<string, unknown> = {};
      if (config.ranker && config.ranker !== 'auto') {
        rankingOptions.ranker = config.ranker;
      }
      if (config.scoreThreshold.trim()) {
        const threshold = Number.parseFloat(config.scoreThreshold);
        if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
          return { error: 'File search score threshold must be between 0 and 1.' };
        }
        rankingOptions.score_threshold = threshold;
      }
      if (Object.keys(rankingOptions).length > 0) {
        tool.ranking_options = rankingOptions;
      }

      return { tool };
    }
    case 'web_search': {
      const tool: Record<string, unknown> = {
        type: config.mode
      };

      const domains = splitList(config.allowedDomains);
      if (domains.length > 0) {
        tool.filters = { allowed_domains: domains };
      }

      if (config.searchContextSize !== 'medium') {
        tool.search_context_size = config.searchContextSize;
      }

      const locationEntries = Object.entries(config.userLocation).reduce(
        (accumulator, [key, value]) => {
          const trimmed = value.trim();
          if (trimmed) {
            accumulator[key] = trimmed;
          }
          return accumulator;
        },
        {} as Record<string, string>
      );

      if (Object.keys(locationEntries).length > 0) {
        tool.user_location = { ...locationEntries, type: 'approximate' };
      }

      return { tool };
    }
    case 'code_interpreter': {
      const fileIds = splitList(config.fileIds);
      const container: Record<string, unknown> = { type: 'auto' };
      if (fileIds.length > 0) {
        container.file_ids = fileIds;
      }
      return {
        tool: {
          type: 'code_interpreter',
          container
        }
      };
    }
    case 'image_generation': {
      const tool: Record<string, unknown> = {
        type: 'image_generation',
        model: config.model,
        size: config.size,
        quality: config.quality,
        background: config.background,
        output_format: config.outputFormat,
        moderation: config.moderation
      };

      if (config.inputFidelity) {
        tool.input_fidelity = config.inputFidelity;
      }

      if (config.partialImages.trim()) {
        const parsed = Number.parseInt(config.partialImages, 10);
        if (Number.isNaN(parsed) || parsed < 0 || parsed > 3) {
          return { error: 'Image generation partial images must be between 0 and 3.' };
        }
        tool.partial_images = parsed;
      }

      if (config.outputCompression.trim()) {
        const parsed = Number.parseInt(config.outputCompression, 10);
        if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
          return { error: 'Image generation compression must be between 0 and 100.' };
        }
        tool.output_compression = parsed;
      }

      return { tool };
    }
    case 'mcp': {
      const serverLabel = config.serverLabel.trim();
      if (!serverLabel) {
        return { error: 'MCP tools require a server label.' };
      }

      const tool: Record<string, unknown> = {
        type: 'mcp',
        server_label: serverLabel
      };

      const serverUrl = config.serverUrl.trim();
      if (serverUrl) {
        tool.server_url = serverUrl;
      }

      if (!serverUrl && config.connectorId) {
        tool.connector_id = config.connectorId;
      }

      const allowedToolNames = splitList(config.allowedToolNames);
      if (config.readOnly || allowedToolNames.length > 0) {
        tool.allowed_tools = {
          ...(config.readOnly ? { read_only: true } : {}),
          ...(allowedToolNames.length > 0 ? { tool_names: allowedToolNames } : {})
        };
      }

      if (config.requireApproval === 'always') {
        tool.require_approval = 'always';
      } else if (config.requireApproval === 'never') {
        tool.require_approval = 'never';
      } else if (config.requireApproval === 'read_only') {
        tool.require_approval = { always: { read_only: true } };
      }

      if (config.serverDescription.trim()) {
        tool.server_description = config.serverDescription.trim();
      }

      if (config.authorization.trim()) {
        tool.authorization = config.authorization.trim();
      }

      if (!tool.server_url && !tool.connector_id) {
        return { error: 'Provide either a server URL or a connector for MCP tools.' };
      }

      return { tool };
    }
    case 'custom': {
      const name = config.name.trim();
      if (!name) {
        return { error: 'Custom tools require a name.' };
      }

      const tool: Record<string, unknown> = {
        type: 'custom',
        name,
        description: config.description.trim() || undefined
      };

      if (config.formatType === 'grammar') {
        const definition = config.grammarDefinition.trim();
        if (!definition) {
          return { error: 'Provide a grammar definition for grammar-based custom tools.' };
        }
        tool.format = {
          type: 'grammar',
          definition,
          syntax: config.grammarSyntax
        };
      } else {
        tool.format = { type: 'text' };
      }

      return { tool };
    }
    default:
      return { error: 'Unsupported tool configuration.' };
  }
};

const prepareToolsForRequest = (
  configs: ToolConfig[]
): { tools: Array<Record<string, unknown>>; error?: string } => {
  const tools: Array<Record<string, unknown>> = [];
  for (const config of configs) {
    const { tool, error } = prepareToolForRequest(config);
    if (error) {
      return { tools: [], error };
    }
    if (tool) {
      tools.push(tool);
    }
  }
  return { tools };
};

const prepareToolChoice = (
  choice: ToolChoiceState
): { toolChoice: string | Record<string, unknown> | null; error?: string } => {
  switch (choice.mode) {
    case 'auto':
    case 'none':
    case 'required':
      return { toolChoice: choice.mode };
    case 'function': {
      const name = choice.name.trim();
      if (!name) {
        return { toolChoice: null, error: 'Select a function name for the tool choice.' };
      }
      return { toolChoice: { type: 'function', name } };
    }
    case 'mcp': {
      const label = choice.serverLabel.trim();
      if (!label) {
        return { toolChoice: null, error: 'Provide a server label for the MCP tool choice.' };
      }
      const payload: Record<string, unknown> = {
        type: 'mcp',
        server_label: label
      };
      if (choice.toolName && choice.toolName.trim()) {
        payload.name = choice.toolName.trim();
      }
      return { toolChoice: payload };
    }
    case 'custom': {
      const name = choice.name.trim();
      if (!name) {
        return { toolChoice: null, error: 'Provide a custom tool name for the tool choice.' };
      }
      return { toolChoice: { type: 'custom', name } };
    }
    default:
      return { toolChoice: null };
  }
};

const summariseToolItem = (rawItem: Record<string, unknown>): ToolSummary | null => {
  const type = typeof rawItem.type === 'string' ? rawItem.type : null;
  if (!type || type === 'message') {
    return null;
  }

  const baseId = typeof rawItem.id === 'string' ? rawItem.id : createId();

  if (type === 'function_call') {
    const name = typeof rawItem.name === 'string' ? rawItem.name : 'function';
    const args = typeof rawItem.arguments === 'string' ? formatMaybeJson(rawItem.arguments) : '';
    const details = truncateText(args || '(No arguments provided.)');
    return {
      id: baseId,
      title: `Function call · ${name}`,
      details
    };
  }

  if (type === 'function_call_output') {
    const callId = typeof rawItem.call_id === 'string' ? rawItem.call_id : 'function';
    const output = typeof rawItem.output === 'string' ? formatMaybeJson(rawItem.output) : '';
    const details = truncateText(output || '(No output returned.)');
    return {
      id: baseId,
      title: `Function result · ${callId}`,
      details
    };
  }

  if (type === 'file_search_call') {
    const status = typeof rawItem.status === 'string' ? rawItem.status : 'unknown';
    const queries = Array.isArray(rawItem.queries)
      ? (rawItem.queries as unknown[])
          .map((entry) => (typeof entry === 'string' ? entry : ''))
          .filter(Boolean)
          .join(', ')
      : '';

    let details = `Status: ${status}`;
    if (queries) {
      details += `\nQueries: ${queries}`;
    }

    if (Array.isArray(rawItem.results) && rawItem.results.length > 0) {
      const topResults = (rawItem.results as Array<Record<string, unknown>>)
        .slice(0, 3)
        .map((result, index) => {
          const name =
            (typeof result.filename === 'string' && result.filename) ||
            (typeof result.file_id === 'string' && result.file_id) ||
            `Result ${index + 1}`;
          const score = typeof result.score === 'number' ? ` (score ${result.score.toFixed(2)})` : '';
          return `• ${name}${score}`;
        })
        .join('\n');
      details += `\nTop results:\n${topResults}`;
    }

    return {
      id: baseId,
      title: 'File search call',
      details: truncateText(details)
    };
  }

  if (type === 'web_search_call') {
    const status = typeof rawItem.status === 'string' ? rawItem.status : 'unknown';
    return {
      id: baseId,
      title: 'Web search call',
      details: `Status: ${status}`
    };
  }

  if (type === 'code_interpreter_call') {
    const status = typeof rawItem.status === 'string' ? rawItem.status : 'unknown';
    let details = `Status: ${status}`;
    if (typeof rawItem.code === 'string' && rawItem.code.trim()) {
      details += `\nCode:\n${truncateText(rawItem.code.trim(), 800)}`;
    }

    if (Array.isArray(rawItem.outputs) && rawItem.outputs.length > 0) {
      const outputs = (rawItem.outputs as Array<Record<string, unknown>>)
        .map((entry) => {
          if (entry.type === 'logs' && typeof entry.logs === 'string') {
            return `Logs:\n${truncateText(entry.logs, 600)}`;
          }
          if (entry.type === 'image' && typeof entry.url === 'string') {
            return `Image: ${entry.url}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n');
      if (outputs) {
        details += `\n${outputs}`;
      }
    }

    return {
      id: baseId,
      title: 'Code interpreter call',
      details: truncateText(details)
    };
  }

  if (type === 'image_generation_call') {
    const status = typeof rawItem.status === 'string' ? rawItem.status : 'unknown';
    const result = typeof rawItem.result === 'string' ? rawItem.result : '';
    const preview = result ? `Result: ${truncateText(result.slice(0, 140))} (length ${result.length} chars)` : 'Result: pending';
    return {
      id: baseId,
      title: 'Image generation call',
      details: `Status: ${status}\n${preview}`
    };
  }

  if (type === 'custom_tool_call') {
    const name = typeof rawItem.name === 'string' ? rawItem.name : 'Custom tool';
    const input = typeof rawItem.input === 'string' ? formatMaybeJson(rawItem.input) : '';
    return {
      id: baseId,
      title: `Custom tool call · ${name}`,
      details: truncateText(input || '(No input provided.)')
    };
  }

  if (type === 'custom_tool_call_output') {
    const callId = typeof rawItem.call_id === 'string' ? rawItem.call_id : 'custom_tool';
    const output = typeof rawItem.output === 'string' ? formatMaybeJson(rawItem.output) : '';
    return {
      id: baseId,
      title: `Custom tool output · ${callId}`,
      details: truncateText(output || '(No output provided.)')
    };
  }

  if (type === 'mcp_call') {
    const name = typeof rawItem.name === 'string' ? rawItem.name : 'MCP tool';
    const server = typeof rawItem.server_label === 'string' ? rawItem.server_label : 'server';
    const args = typeof rawItem.arguments === 'string' ? formatMaybeJson(rawItem.arguments) : '';
    const output = typeof rawItem.output === 'string' ? formatMaybeJson(rawItem.output) : '';
    const error = typeof rawItem.error === 'string' ? rawItem.error : '';

    const parts = [`Server: ${server}`];
    if (args) {
      parts.push(`Arguments:\n${truncateText(args)}`);
    }
    if (output) {
      parts.push(`Output:\n${truncateText(output)}`);
    }
    if (error) {
      parts.push(`Error: ${error}`);
    }

    return {
      id: baseId,
      title: `MCP tool call · ${name}`,
      details: parts.join('\n\n')
    };
  }

  if (type === 'mcp_list_tools') {
    const server = typeof rawItem.server_label === 'string' ? rawItem.server_label : 'server';
    let details = `Server: ${server}`;
    if (Array.isArray(rawItem.tools) && rawItem.tools.length > 0) {
      const names = (rawItem.tools as Array<Record<string, unknown>>)
        .slice(0, 5)
        .map((tool) => (typeof tool.name === 'string' ? `• ${tool.name}` : ''))
        .filter(Boolean)
        .join('\n');
      if (names) {
        details += `\nTools:\n${names}`;
      }
    }
    if (typeof rawItem.error === 'string' && rawItem.error) {
      details += `\nError: ${rawItem.error}`;
    }
    return {
      id: baseId,
      title: 'MCP list tools',
      details: truncateText(details)
    };
  }

  if (type === 'mcp_approval_request') {
    const name = typeof rawItem.name === 'string' ? rawItem.name : 'tool';
    const server = typeof rawItem.server_label === 'string' ? rawItem.server_label : 'server';
    const args = typeof rawItem.arguments === 'string' ? formatMaybeJson(rawItem.arguments) : '';
    const details = [`Server: ${server}`, args ? `Arguments:\n${truncateText(args)}` : '']
      .filter(Boolean)
      .join('\n\n');
    return {
      id: baseId,
      title: `MCP approval needed · ${name}`,
      details: details || 'Approval requested.'
    };
  }

  const fallback = truncateText(JSON.stringify(rawItem, null, 2) || '');
  return {
    id: baseId,
    title: `Tool event · ${type}`,
    details: fallback || 'The assistant emitted a tool event.'
  };
};

const parseAssistantOutput = (output: unknown): { text: string; summaries: ToolSummary[] } => {
  if (!Array.isArray(output)) {
    return { text: '', summaries: [] };
  }

  const textFragments: string[] = [];
  const summaries: ToolSummary[] = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    if (record.type === 'message' && Array.isArray(record.content)) {
      const textContent = (record.content as unknown[])
        .map((entry) =>
          entry && typeof entry === 'object' && (entry as Record<string, unknown>).type === 'output_text'
            ? (entry as Record<string, unknown>).text
            : null
        )
        .filter((text): text is string => typeof text === 'string')
        .join('\n')
        .trim();
      if (textContent) {
        textFragments.push(textContent);
      }
      continue;
    }

    const summary = summariseToolItem(record);
    if (summary) {
      summaries.push(summary);
    }
  }

  return {
    text: textFragments.join('\n\n').trim(),
    summaries
  };
};

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [model, setModel] = useState(MODEL_OPTIONS[0]?.value ?? 'gpt-5');
  const [temperature, setTemperature] = useState(0.7);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null);
  const [lastResponseId, setLastResponseId] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [toolChoice, setToolChoice] = useState<ToolChoiceState>({ mode: 'auto' });
  const [toolTypeToAdd, setToolTypeToAdd] = useState<ToolType>('function');
  const [parallelToolCalls, setParallelToolCalls] = useState(true);
  const [maxOutputTokens, setMaxOutputTokens] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasHydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ConversationState>;
      if (Array.isArray(parsed.messages)) {
        setMessages(
          parsed.messages
            .filter((message): message is ChatMessage =>
              Boolean(message && message.role && message.content)
            )
            .map((message) => ({
              ...message,
              createdAt:
                typeof message.createdAt === 'number' ? message.createdAt : Date.now()
            }))
        );
      }
      if (typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.trim().length > 0) {
        setSystemPrompt(parsed.systemPrompt);
      }
      if (typeof parsed.model === 'string' && parsed.model.trim().length > 0) {
        setModel(parsed.model);
      }
      if (typeof parsed.temperature === 'number' && !Number.isNaN(parsed.temperature)) {
        setTemperature(parsed.temperature);
      }
      if (
        parsed.reasoningEffort === null ||
        (typeof parsed.reasoningEffort === 'string' &&
          ['minimal', 'low', 'medium', 'high'].includes(parsed.reasoningEffort))
      ) {
        setReasoningEffort(parsed.reasoningEffort ?? null);
      }
      if (typeof parsed.lastResponseId === 'string') {
        setLastResponseId(parsed.lastResponseId.trim().length > 0 ? parsed.lastResponseId.trim() : null);
      } else if (parsed.lastResponseId === null) {
        setLastResponseId(null);
      }
      if (Array.isArray(parsed.tools)) {
        const restored = parsed.tools
          .map((tool) => restoreToolConfig(tool))
          .filter((tool): tool is ToolConfig => Boolean(tool));
        setTools(restored);
      }
      if (parsed.toolChoice && typeof parsed.toolChoice === 'object') {
        const candidate = parsed.toolChoice as Record<string, unknown>;
        const mode = candidate.mode;
        if (mode === 'function' && typeof candidate.name === 'string') {
          setToolChoice({ mode: 'function', name: candidate.name });
        } else if (mode === 'mcp' && typeof candidate.serverLabel === 'string') {
          setToolChoice({
            mode: 'mcp',
            serverLabel: candidate.serverLabel,
            toolName: typeof candidate.toolName === 'string' ? candidate.toolName : undefined
          });
        } else if (mode === 'custom' && typeof candidate.name === 'string') {
          setToolChoice({ mode: 'custom', name: candidate.name });
        } else if (mode === 'auto' || mode === 'none' || mode === 'required') {
          setToolChoice({ mode });
        }
      }
      if (typeof parsed.parallelToolCalls === 'boolean') {
        setParallelToolCalls(parsed.parallelToolCalls);
      }
      if (typeof parsed.maxOutputTokens === 'number' && !Number.isNaN(parsed.maxOutputTokens)) {
        setMaxOutputTokens(parsed.maxOutputTokens);
      } else if (parsed.maxOutputTokens === null) {
        setMaxOutputTokens(null);
      }
    } catch (localStorageError) {
      console.warn('Unable to hydrate conversation state from localStorage.', localStorageError);
    } finally {
      hasHydrated.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated.current) {
      return;
    }
    try {
      const snapshot: ConversationState = {
        messages,
        systemPrompt,
        model,
        temperature,
        reasoningEffort,
        lastResponseId,
        tools,
        toolChoice,
        parallelToolCalls,
        maxOutputTokens
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (localStorageError) {
      console.warn('Unable to persist conversation state to localStorage.', localStorageError);
    }
  }, [
    messages,
    systemPrompt,
    model,
    temperature,
    reasoningEffort,
    lastResponseId,
    tools,
    toolChoice,
    parallelToolCalls,
    maxOutputTokens
  ]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!model.startsWith('gpt-5') && !model.startsWith('o') && reasoningEffort) {
      setReasoningEffort(null);
    }
  }, [model, reasoningEffort]);

  const sendMessage = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const trimmedInstructions = systemPrompt.trim();

    const { tools: preparedTools, error: toolsError } = prepareToolsForRequest(tools);
    if (toolsError) {
      setError(toolsError);
      return;
    }

    const { toolChoice: preparedToolChoice, error: toolChoiceError } = prepareToolChoice(toolChoice);
    if (toolChoiceError) {
      setError(toolChoiceError);
      return;
    }

    if (toolChoice.mode === 'required' && preparedTools.length === 0) {
      setError('Add at least one tool before requiring tool calls.');
      return;
    }

    if (toolChoice.mode === 'function') {
      const targetName = toolChoice.name.trim();
      const hasFunctionTool = preparedTools.some((tool) => {
        const typed = tool as { type?: string; name?: string };
        return typed.type === 'function' && typeof typed.name === 'string' && typed.name === targetName;
      });
      if (!hasFunctionTool) {
        setError('Add a function tool with the specified name before forcing it.');
        return;
      }
    }

    if (toolChoice.mode === 'mcp') {
      const targetLabel = toolChoice.serverLabel.trim();
      const hasMcpTool = preparedTools.some((tool) => {
        const typed = tool as { type?: string; server_label?: string };
        return typed.type === 'mcp' && typeof typed.server_label === 'string' && typed.server_label === targetLabel;
      });
      if (!hasMcpTool) {
        setError('Add an MCP tool with the specified server label before forcing it.');
        return;
      }
    }

    if (toolChoice.mode === 'custom') {
      const targetName = toolChoice.name.trim();
      const hasCustomTool = preparedTools.some((tool) => {
        const typed = tool as { type?: string; name?: string };
        return typed.type === 'custom' && typeof typed.name === 'string' && typed.name === targetName;
      });
      if (!hasCustomTool) {
        setError('Add a custom tool with the specified name before forcing it.');
        return;
      }
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now()
    };

    const nextHistory = [...messages, userMessage];
    const shouldSendHistory = !lastResponseId && messages.length > 0;

    const messagePayload = shouldSendHistory
      ? nextHistory.map(({ role, content }) => ({ role, content }))
      : ([{ role: 'user' as const, content: trimmed }] as Array<{
          role: 'user' | 'assistant';
          content: string;
        }>);

    const requestBody: Record<string, unknown> = {
      messages: messagePayload,
      model,
      temperature
    };

    if (trimmedInstructions.length > 0) {
      requestBody.instructions = trimmedInstructions;
    }

    if (reasoningEffort) {
      requestBody.reasoningEffort = reasoningEffort;
    }

    if (preparedTools.length > 0) {
      requestBody.tools = preparedTools;
    }

    if (preparedToolChoice !== null) {
      requestBody.toolChoice = preparedToolChoice;
    }

    requestBody.parallelToolCalls = parallelToolCalls;

    if (maxOutputTokens !== null) {
      requestBody.maxOutputTokens = maxOutputTokens;
    }

    if (lastResponseId && !shouldSendHistory) {
      requestBody.previousResponseId = lastResponseId;
    }

    setMessages(nextHistory);
    setInputValue('');
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (!response.ok) {
        const message =
          (data && typeof data.error === 'string'
            ? data.error
            : 'Unable to generate a response. Please try again.') ??
          'Unable to generate a response. Please try again.';
        throw new Error(message);
      }

      const { text: parsedText, summaries } = parseAssistantOutput(data?.output);

      const assistantContent =
        typeof data?.outputText === 'string' && data.outputText.trim().length > 0
          ? data.outputText.trim()
          : parsedText || 'The assistant responded via tool calls.';

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: assistantContent,
        createdAt: Date.now(),
        toolSummaries: summaries.length > 0 ? summaries : undefined
      };

      setMessages((previous) => [...previous, assistantMessage]);
      setUsage(toTokenUsage(data?.usage));
      if (typeof data?.id === 'string' && data.id.trim().length > 0) {
        setLastResponseId(data.id.trim());
      }
    } catch (requestError) {
      console.error('Response request failed', requestError);
      const fallbackMessage =
        requestError instanceof Error && requestError.message
          ? requestError.message
          : 'Something went wrong. Please check the server logs.';
      setError(fallbackMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendMessage();
  };

  const handleComposerKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
  };

  const handleClearConversation = () => {
    setMessages([]);
    setUsage(null);
    setError(null);
    setLastResponseId(null);
  };

  const handleResetSystemPrompt = () => {
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
  };

  const handleAddTool = () => {
    setTools((previous) => [...previous, createToolConfig(toolTypeToAdd)]);
  };

  const handleRemoveTool = (id: string) => {
    setTools((previous) => previous.filter((tool) => tool.id !== id));
  };

  const updateToolConfig = (id: string, updater: (tool: ToolConfig) => ToolConfig) => {
    setTools((previous) => previous.map((tool) => (tool.id === id ? updater(tool) : tool)));
  };

  const renderToolFields = (tool: ToolConfig) => {
    switch (tool.type) {
      case 'function': {
        const apply = (updates: Partial<typeof tool>) =>
          updateToolConfig(tool.id, (current) => ({ ...(current as typeof tool), ...updates } as ToolConfig));
        return (
          <>
            <label className="field">
              <span className="field__label">Function name</span>
              <input
                value={tool.name}
                onChange={(event) => apply({ name: event.target.value })}
                placeholder="get_weather"
              />
            </label>
            <label className="field">
              <span className="field__label">Description</span>
              <textarea
                value={tool.description}
                onChange={(event) => apply({ description: event.target.value })}
                rows={2}
              />
            </label>
            <label className="field">
              <span className="field__label">Parameters (JSON Schema)</span>
              <textarea
                value={tool.parameters}
                onChange={(event) => apply({ parameters: event.target.value })}
                rows={4}
              />
              <p className="field__hint">Provide a JSON schema describing the function parameters.</p>
            </label>
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={tool.strict}
                onChange={(event) => apply({ strict: event.target.checked })}
              />
              <span>Enforce strict schema validation</span>
            </label>
          </>
        );
      }
      case 'file_search': {
        const apply = (updates: Partial<typeof tool>) =>
          updateToolConfig(tool.id, (current) => ({ ...(current as typeof tool), ...updates } as ToolConfig));
        return (
          <>
            <label className="field">
              <span className="field__label">Vector store IDs</span>
              <textarea
                value={tool.vectorStoreIds}
                onChange={(event) => apply({ vectorStoreIds: event.target.value })}
                rows={2}
                placeholder="vs_123, vs_456"
              />
              <p className="field__hint">Comma or newline separated vector store identifiers.</p>
            </label>
            <label className="field">
              <span className="field__label">Max results</span>
              <input
                type="number"
                min={1}
                max={50}
                value={tool.maxResults}
                onChange={(event) => apply({ maxResults: event.target.value })}
                placeholder="Model default"
              />
            </label>
            <label className="field">
              <span className="field__label">Score threshold</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={tool.scoreThreshold}
                onChange={(event) => apply({ scoreThreshold: event.target.value })}
                placeholder="0.5"
              />
            </label>
            <label className="field">
              <span className="field__label">Ranker</span>
              <select value={tool.ranker} onChange={(event) => apply({ ranker: event.target.value as typeof tool.ranker })}>
                <option value="auto">Auto</option>
                <option value="default-2024-11-15">default-2024-11-15</option>
              </select>
            </label>
          </>
        );
      }
      case 'web_search': {
        const apply = (updates: Partial<typeof tool>) =>
          updateToolConfig(tool.id, (current) => ({ ...(current as typeof tool), ...updates } as ToolConfig));
        return (
          <>
            <label className="field">
              <span className="field__label">Web search version</span>
              <select value={tool.mode} onChange={(event) => apply({ mode: event.target.value as typeof tool.mode })}>
                <option value="web_search">web_search</option>
                <option value="web_search_2025_08_26">web_search_2025_08_26</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Allowed domains</span>
              <textarea
                value={tool.allowedDomains}
                onChange={(event) => apply({ allowedDomains: event.target.value })}
                rows={2}
                placeholder="example.com"
              />
              <p className="field__hint">Comma or newline separated domains. Leave blank to search the open web.</p>
            </label>
            <label className="field">
              <span className="field__label">Context size</span>
              <select
                value={tool.searchContextSize}
                onChange={(event) => apply({ searchContextSize: event.target.value as typeof tool.searchContextSize })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <div className="tool-config__grid">
              <label className="field">
                <span className="field__label">City</span>
                <input
                  value={tool.userLocation.city}
                  onChange={(event) =>
                    apply({
                      userLocation: {
                        ...tool.userLocation,
                        city: event.target.value
                      }
                    })
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">Region</span>
                <input
                  value={tool.userLocation.region}
                  onChange={(event) =>
                    apply({
                      userLocation: {
                        ...tool.userLocation,
                        region: event.target.value
                      }
                    })
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">Country</span>
                <input
                  value={tool.userLocation.country}
                  onChange={(event) =>
                    apply({
                      userLocation: {
                        ...tool.userLocation,
                        country: event.target.value
                      }
                    })
                  }
                  placeholder="US"
                />
              </label>
              <label className="field">
                <span className="field__label">Timezone</span>
                <input
                  value={tool.userLocation.timezone}
                  onChange={(event) =>
                    apply({
                      userLocation: {
                        ...tool.userLocation,
                        timezone: event.target.value
                      }
                    })
                  }
                  placeholder="America/Los_Angeles"
                />
              </label>
            </div>
          </>
        );
      }
      case 'code_interpreter': {
        const apply = (updates: Partial<typeof tool>) =>
          updateToolConfig(tool.id, (current) => ({ ...(current as typeof tool), ...updates } as ToolConfig));
        return (
          <label className="field">
            <span className="field__label">File IDs</span>
            <textarea
              value={tool.fileIds}
              onChange={(event) => apply({ fileIds: event.target.value })}
              rows={2}
              placeholder="file_123, file_456"
            />
            <p className="field__hint">Optional comma or newline separated file IDs to mount into the session.</p>
          </label>
        );
      }
      case 'image_generation': {
        const apply = (updates: Partial<typeof tool>) =>
          updateToolConfig(tool.id, (current) => ({ ...(current as typeof tool), ...updates } as ToolConfig));
        return (
          <>
            <label className="field">
              <span className="field__label">Model</span>
              <select value={tool.model} onChange={(event) => apply({ model: event.target.value as typeof tool.model })}>
                <option value="gpt-image-1">gpt-image-1</option>
              </select>
            </label>
            <div className="tool-config__grid">
              <label className="field">
                <span className="field__label">Size</span>
                <select value={tool.size} onChange={(event) => apply({ size: event.target.value as typeof tool.size })}>
                  <option value="auto">Auto</option>
                  <option value="1024x1024">1024×1024</option>
                  <option value="1536x1024">1536×1024</option>
                  <option value="1024x1536">1024×1536</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Quality</span>
                <select value={tool.quality} onChange={(event) => apply({ quality: event.target.value as typeof tool.quality })}>
                  <option value="auto">Auto</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Background</span>
                <select
                  value={tool.background}
                  onChange={(event) => apply({ background: event.target.value as typeof tool.background })}
                >
                  <option value="auto">Auto</option>
                  <option value="transparent">Transparent</option>
                  <option value="opaque">Opaque</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Output format</span>
                <select
                  value={tool.outputFormat}
                  onChange={(event) => apply({ outputFormat: event.target.value as typeof tool.outputFormat })}
                >
                  <option value="png">PNG</option>
                  <option value="webp">WEBP</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span className="field__label">Moderation</span>
              <select
                value={tool.moderation}
                onChange={(event) => apply({ moderation: event.target.value as typeof tool.moderation })}
              >
                <option value="auto">Auto</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Input fidelity</span>
              <select
                value={tool.inputFidelity}
                onChange={(event) => apply({ inputFidelity: event.target.value as typeof tool.inputFidelity })}
              >
                <option value="">Model default</option>
                <option value="low">Low</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Partial images (0-3)</span>
              <input
                type="number"
                min={0}
                max={3}
                value={tool.partialImages}
                onChange={(event) => apply({ partialImages: event.target.value })}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span className="field__label">Output compression (0-100)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={tool.outputCompression}
                onChange={(event) => apply({ outputCompression: event.target.value })}
                placeholder="100"
              />
            </label>
          </>
        );
      }
      case 'mcp': {
        const apply = (updates: Partial<typeof tool>) =>
          updateToolConfig(tool.id, (current) => ({ ...(current as typeof tool), ...updates } as ToolConfig));
        return (
          <>
            <label className="field">
              <span className="field__label">Server label</span>
              <input
                value={tool.serverLabel}
                onChange={(event) => apply({ serverLabel: event.target.value })}
                placeholder="my-connector"
              />
            </label>
            <label className="field">
              <span className="field__label">Server URL</span>
              <input
                value={tool.serverUrl}
                onChange={(event) => apply({ serverUrl: event.target.value })}
                placeholder="https://example.com/mcp"
              />
            </label>
            <label className="field">
              <span className="field__label">Connector</span>
              <select
                value={tool.connectorId}
                onChange={(event) => apply({ connectorId: event.target.value as typeof tool.connectorId })}
              >
                {CONNECTOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="field__hint">Provide either a custom server URL or select a managed connector.</p>
            </label>
            <label className="field">
              <span className="field__label">Allowed tool names</span>
              <textarea
                value={tool.allowedToolNames}
                onChange={(event) => apply({ allowedToolNames: event.target.value })}
                rows={2}
                placeholder="tool_a, tool_b"
              />
            </label>
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={tool.readOnly}
                onChange={(event) => apply({ readOnly: event.target.checked })}
              />
              <span>Limit to read-only operations</span>
            </label>
            <label className="field">
              <span className="field__label">Require approval</span>
              <select
                value={tool.requireApproval}
                onChange={(event) => apply({ requireApproval: event.target.value as typeof tool.requireApproval })}
              >
                <option value="never">Never</option>
                <option value="always">Always</option>
                <option value="read_only">Only for write operations</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Server description</span>
              <textarea
                value={tool.serverDescription}
                onChange={(event) => apply({ serverDescription: event.target.value })}
                rows={2}
              />
            </label>
            <label className="field">
              <span className="field__label">Authorization token</span>
              <input
                value={tool.authorization}
                onChange={(event) => apply({ authorization: event.target.value })}
                placeholder="Optional"
              />
            </label>
          </>
        );
      }
      case 'custom': {
        const apply = (updates: Partial<typeof tool>) =>
          updateToolConfig(tool.id, (current) => ({ ...(current as typeof tool), ...updates } as ToolConfig));
        return (
          <>
            <label className="field">
              <span className="field__label">Tool name</span>
              <input
                value={tool.name}
                onChange={(event) => apply({ name: event.target.value })}
                placeholder="my_custom_tool"
              />
            </label>
            <label className="field">
              <span className="field__label">Description</span>
              <textarea
                value={tool.description}
                onChange={(event) => apply({ description: event.target.value })}
                rows={2}
              />
            </label>
            <label className="field">
              <span className="field__label">Input format</span>
              <select
                value={tool.formatType}
                onChange={(event) => apply({ formatType: event.target.value as typeof tool.formatType })}
              >
                <option value="text">Free text</option>
                <option value="grammar">Grammar</option>
              </select>
            </label>
            {tool.formatType === 'grammar' && (
              <>
                <label className="field">
                  <span className="field__label">Grammar definition</span>
                  <textarea
                    value={tool.grammarDefinition}
                    onChange={(event) => apply({ grammarDefinition: event.target.value })}
                    rows={3}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Grammar syntax</span>
                  <select
                    value={tool.grammarSyntax}
                    onChange={(event) => apply({ grammarSyntax: event.target.value as typeof tool.grammarSyntax })}
                  >
                    <option value="lark">Lark</option>
                    <option value="regex">Regex</option>
                  </select>
                </label>
              </>
            )}
          </>
        );
      }
      default:
        return null;
    }
  };

  const supportsReasoningControls = model.startsWith('gpt-5') || model.startsWith('o');
  const reasoningSelectValue = reasoningEffort ?? '';

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>OpenAI Responses Playground</h1>
          <p className="app__tagline">Experiment with multi-turn conversations powered by the OpenAI Responses API.</p>
        </div>
      </header>
      <main className="app__content">
        <section className="conversation">
          <div className="conversation__messages" ref={scrollContainerRef}>
            {messages.length === 0 && !isLoading ? (
              <div className="conversation__empty">
                <h2>Welcome! 👋</h2>
                <p>
                  Start the conversation below. Each turn sends only your latest message while the Responses API keeps track of
                  context. Adjust the instructions and model settings from the panel on the right.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article key={message.id} className={`message message--${message.role}`}>
                  <header className="message__meta">
                    <span className="message__role">{message.role === 'user' ? 'You' : 'Assistant'}</span>
                    <span className="message__time">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </header>
                  <p className="message__body">{message.content}</p>
                  {message.toolSummaries && message.toolSummaries.length > 0 && (
                    <div className="message__tools">
                      {message.toolSummaries.map((summary) => (
                        <div key={summary.id} className="tool-summary">
                          <h3 className="tool-summary__title">{summary.title}</h3>
                          <pre className="tool-summary__details">{summary.details}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
            {isLoading && (
              <div className="message message--assistant message--pending">
                <div className="spinner" aria-hidden />
                <p>The assistant is thinking…</p>
              </div>
            )}
          </div>
          {error && <div className="conversation__error" role="alert">{error}</div>}
          <form className="composer" onSubmit={handleSubmit}>
            <label htmlFor="composer-input" className="visually-hidden">
              Message the assistant
            </label>
            <textarea
              id="composer-input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask anything…"
              rows={3}
              disabled={isLoading}
            />
            <div className="composer__footer">
              <button
                type="button"
                className="button button--ghost"
                onClick={handleClearConversation}
                disabled={messages.length === 0 && !error}
              >
                Clear conversation
              </button>
              <div className="composer__actions">
                <span className="composer__hint">Press Enter to send · Shift + Enter for a new line</span>
                <button type="submit" className="button button--primary" disabled={isLoading || inputValue.trim().length === 0}>
                  {isLoading ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </form>
        </section>
        <aside className="sidebar">
          <section className="card">
            <header className="card__header">
              <h2>Conversation settings</h2>
            </header>
            <div className="card__body">
              <label className="field">
                <span className="field__label">Model</span>
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Temperature</span>
                <div className="field__range">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={temperature}
                    onChange={(event) => setTemperature(Number(event.target.value))}
                  />
                  <span className="field__value">{temperature.toFixed(1)}</span>
                </div>
              </label>
              <label className="field">
                <span className="field__label">Reasoning effort</span>
                <select
                  value={reasoningSelectValue}
                  onChange={(event) =>
                    setReasoningEffort(
                      event.target.value ? (event.target.value as ReasoningEffort) : null
                    )
                  }
                  disabled={!supportsReasoningControls}
                >
                  {REASONING_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!supportsReasoningControls && (
                  <p className="field__hint">Reasoning controls are available for gpt-5 and o-series models.</p>
                )}
              </label>
            </div>
          </section>
          <section className="card">
            <header className="card__header">
              <h2>System prompt</h2>
              <button type="button" className="button button--ghost" onClick={handleResetSystemPrompt}>
                Reset
              </button>
            </header>
            <div className="card__body">
              <label className="field">
                <span className="visually-hidden">System prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={6}
                />
              </label>
              <p className="card__hint">
                The system prompt feeds the Responses API instructions field to guide the tone, behaviour, and expertise of the
                assistant. Customize it to adapt the assistant to your use case.
              </p>
            </div>
          </section>
          <section className="card">
            <header className="card__header">
              <h2>Tools &amp; advanced settings</h2>
            </header>
            <div className="card__body">
              <label className="field">
                <span className="field__label">Tool choice</span>
                <select
                  value={toolChoice.mode}
                  onChange={(event) => {
                    const mode = event.target.value as ToolChoiceState['mode'];
                    switch (mode) {
                      case 'function':
                        setToolChoice({ mode: 'function', name: '' });
                        break;
                      case 'mcp':
                        setToolChoice({ mode: 'mcp', serverLabel: '', toolName: '' });
                        break;
                      case 'custom':
                        setToolChoice({ mode: 'custom', name: '' });
                        break;
                      default:
                        setToolChoice({ mode });
                    }
                  }}
                >
                  {TOOL_CHOICE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {toolChoice.mode === 'function' && (
                <label className="field">
                  <span className="field__label">Function name to call</span>
                  <input
                    value={toolChoice.name}
                    onChange={(event) => setToolChoice({ mode: 'function', name: event.target.value })}
                    placeholder="get_weather"
                  />
                </label>
              )}
              {toolChoice.mode === 'mcp' && (
                <>
                  <label className="field">
                    <span className="field__label">Server label</span>
                    <input
                      value={toolChoice.serverLabel}
                      onChange={(event) =>
                        setToolChoice({
                          mode: 'mcp',
                          serverLabel: event.target.value,
                          toolName: toolChoice.toolName
                        })
                      }
                      placeholder="my-connector"
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Tool name (optional)</span>
                    <input
                      value={toolChoice.toolName ?? ''}
                      onChange={(event) =>
                        setToolChoice({
                          mode: 'mcp',
                          serverLabel: toolChoice.serverLabel,
                          toolName: event.target.value
                        })
                      }
                      placeholder="list_files"
                    />
                  </label>
                </>
              )}
              {toolChoice.mode === 'custom' && (
                <label className="field">
                  <span className="field__label">Custom tool name</span>
                  <input
                    value={toolChoice.name}
                    onChange={(event) => setToolChoice({ mode: 'custom', name: event.target.value })}
                    placeholder="custom_tool"
                  />
                </label>
              )}
              <label className="field field--checkbox">
                <input
                  type="checkbox"
                  checked={parallelToolCalls}
                  onChange={(event) => setParallelToolCalls(event.target.checked)}
                />
                <span>Allow the model to invoke tools in parallel</span>
              </label>
              <label className="field">
                <span className="field__label">Max output tokens</span>
                <input
                  type="number"
                  min={1}
                  value={maxOutputTokens ?? ''}
                  onChange={(event) => {
                    const { value } = event.target;
                    if (value === '') {
                      setMaxOutputTokens(null);
                      return;
                    }
                    const parsed = Number.parseInt(value, 10);
                    setMaxOutputTokens(Number.isNaN(parsed) ? null : parsed);
                  }}
                  placeholder="Model default"
                />
              </label>
              <div className="tool-manager">
                <label className="field">
                  <span className="field__label">Add a tool</span>
                  <div className="tool-manager__controls">
                    <select
                      value={toolTypeToAdd}
                      onChange={(event) => setToolTypeToAdd(event.target.value as ToolType)}
                    >
                      {Object.entries(TOOL_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="button button--ghost" onClick={handleAddTool}>
                      Add
                    </button>
                  </div>
                </label>
                {tools.length === 0 ? (
                  <p className="card__hint">No tools configured yet. Add one to extend the assistant.</p>
                ) : (
                  tools.map((tool) => (
                    <div key={tool.id} className="tool-config">
                      <header className="tool-config__header">
                        <h3>{TOOL_TYPE_LABELS[tool.type]}</h3>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => handleRemoveTool(tool.id)}
                        >
                          Remove
                        </button>
                      </header>
                      <div className="tool-config__body">{renderToolFields(tool)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
          {usage && (
            <section className="card">
              <header className="card__header">
                <h2>Token usage</h2>
              </header>
              <div className="card__body">
                <dl className="usage">
                  <div>
                    <dt>Input</dt>
                    <dd>{usage.inputTokens}</dd>
                  </div>
                  <div>
                    <dt>Output</dt>
                    <dd>{usage.outputTokens}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{usage.totalTokens}</dd>
                  </div>
                  {typeof usage.cachedTokens === 'number' && (
                    <div>
                      <dt>Cached</dt>
                      <dd>{usage.cachedTokens}</dd>
                    </div>
                  )}
                  {typeof usage.reasoningTokens === 'number' && (
                    <div>
                      <dt>Reasoning</dt>
                      <dd>{usage.reasoningTokens}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </section>
          )}
          <section className="card">
            <header className="card__header">
              <h2>Tips</h2>
            </header>
            <div className="card__body">
              <ul className="tips">
                <li>
                  Multi-turn requests reuse stored response IDs from the Responses API, so each turn only needs your newest
                  message.
                </li>
                <li>Set a reasoning effort when using gpt-5 or o-series models to balance depth and latency.</li>
                <li>Monitor cached and reasoning token counters to understand cost optimisation and model behaviour.</li>
              </ul>
            </div>
          </section>
        </aside>
      </main>
      <footer className="app__footer">
        Built with React, TypeScript, Express, and the OpenAI Responses API.
      </footer>
    </div>
  );
}

export default App;

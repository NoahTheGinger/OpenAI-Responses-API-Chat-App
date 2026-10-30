import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
const port = Number.parseInt(process.env.PORT ?? '3001', 10);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    'Warning: OPENAI_API_KEY is not defined. The responses endpoint will return errors until it is provided.'
  );
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ResponseMessage = {
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string;
};

const sanitizeMessages = (messages: unknown): ResponseMessage[] => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages must be a non-empty array.');
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') {
      throw new Error(`Message at index ${index} is not a valid object.`);
    }

    const { role, content } = message as Record<string, unknown>;

    if (
      role !== 'user' &&
      role !== 'assistant' &&
      role !== 'system' &&
      role !== 'developer'
    ) {
      throw new Error(`Message at index ${index} has an invalid role.`);
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error(`Message at index ${index} must include text content.`);
    }

    return {
      role,
      content: content.trim()
    };
  });
};

const extractOutputText = (output: unknown): string => {
  if (!Array.isArray(output)) {
    return '';
  }

  return output
    .flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const typedItem = item as Record<string, unknown>;
      if (typedItem.type !== 'message' || !Array.isArray(typedItem.content)) {
        return [];
      }

      return (typedItem.content as unknown[])
        .filter(
          (entry): entry is { type: string; text: string } =>
            Boolean(
              entry &&
                typeof entry === 'object' &&
                (entry as Record<string, unknown>).type === 'output_text' &&
                typeof (entry as Record<string, unknown>).text === 'string'
            )
        )
        .map((entry) => entry.text);
    })
    .join('\n')
    .trim();
};

const handleResponseRequest = async (request: Request, response: Response) => {
  if (!process.env.OPENAI_API_KEY) {
    return response.status(500).json({ error: 'Missing OpenAI API key on the server.' });
  }

  let messages: ResponseMessage[];
  try {
    messages = sanitizeMessages(request.body?.messages);
  } catch (parseError) {
    return response.status(400).json({
      error:
        parseError instanceof Error
          ? parseError.message
          : 'The request payload is invalid. Please check the provided messages.'
    });
  }

  const model =
    typeof request.body?.model === 'string' && request.body.model.trim().length > 0
      ? request.body.model.trim()
      : 'gpt-5';

  const temperature =
    typeof request.body?.temperature === 'number' && !Number.isNaN(request.body.temperature)
      ? Math.min(2, Math.max(0, request.body.temperature))
      : 0.7;

  const instructions =
    typeof request.body?.instructions === 'string' && request.body.instructions.trim().length > 0
      ? request.body.instructions.trim()
      : undefined;

  const reasoningEffort =
    typeof request.body?.reasoningEffort === 'string' &&
    ['minimal', 'low', 'medium', 'high'].includes(request.body.reasoningEffort)
      ? (request.body.reasoningEffort as 'minimal' | 'low' | 'medium' | 'high')
      : null;

  const supportsReasoning = model.startsWith('gpt-5') || model.startsWith('o');

  const previousResponseId =
    typeof request.body?.previousResponseId === 'string' &&
    request.body.previousResponseId.trim().length > 0
      ? request.body.previousResponseId.trim()
      : undefined;

  const tools = Array.isArray(request.body?.tools)
    ? (request.body.tools as unknown[]).filter((tool): tool is Record<string, unknown> =>
        Boolean(tool && typeof tool === 'object' && typeof (tool as Record<string, unknown>).type === 'string')
      )
    : [];

  const toolChoiceInput = request.body?.toolChoice;
  let toolChoice: string | Record<string, unknown> | undefined;
  if (typeof toolChoiceInput === 'string') {
    if (['auto', 'none', 'required'].includes(toolChoiceInput)) {
      toolChoice = toolChoiceInput;
    }
  } else if (toolChoiceInput && typeof toolChoiceInput === 'object') {
    toolChoice = toolChoiceInput as Record<string, unknown>;
  }

  const parallelToolCalls =
    typeof request.body?.parallelToolCalls === 'boolean' ? request.body.parallelToolCalls : undefined;

  const maxOutputTokens =
    typeof request.body?.maxOutputTokens === 'number' &&
    Number.isFinite(request.body.maxOutputTokens) &&
    request.body.maxOutputTokens > 0
      ? Math.floor(request.body.maxOutputTokens)
      : undefined;

  try {
    const apiResponse = await openai.responses.create({
      model,
      // Reasoning models reject sampling parameters such as temperature
      ...(supportsReasoning ? {} : { temperature }),
      input: messages.map(({ role, content }) => ({
        type: 'message' as const,
        role,
        content
      })),
      ...(instructions ? { instructions } : {}),
      ...(reasoningEffort && supportsReasoning ? { reasoning: { effort: reasoningEffort } } : {}),
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(tools.length > 0 ? { tools: tools as unknown as OpenAI.Responses.Tool[] } : {}),
      ...(toolChoice !== undefined
        ? { tool_choice: toolChoice as OpenAI.Responses.ResponseCreateParams['tool_choice'] }
        : {}),
      ...(typeof parallelToolCalls === 'boolean' ? { parallel_tool_calls: parallelToolCalls } : {}),
      ...(typeof maxOutputTokens === 'number' ? { max_output_tokens: maxOutputTokens } : {})
    });

    const outputText =
      (typeof apiResponse.output_text === 'string' && apiResponse.output_text.trim().length > 0
        ? apiResponse.output_text.trim()
        : extractOutputText(apiResponse.output)) || '';

    return response.json({
      id: apiResponse.id,
      model: apiResponse.model,
      created: apiResponse.created_at,
      outputText,
      usage: apiResponse.usage,
      output: apiResponse.output,
      toolChoice: apiResponse.tool_choice,
      tools: apiResponse.tools
    });
  } catch (error) {
    console.error('OpenAI responses API error:', error);

    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Unexpected error calling the OpenAI API.';

    return response.status(500).json({ error: message });
  }
};

app.post('/api/respond', handleResponseRequest);
app.post('/api/chat', handleResponseRequest);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));
  app.get('*', (_request, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

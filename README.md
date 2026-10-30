# OpenAI Responses Playground

A lightweight yet elegant chat application built with React, TypeScript, and Express. It showcases how to orchestrate multi-turn conversations with the OpenAI Responses API, including reasoning controls and the latest usage telemetry.

## Features

- ⚡️ Fast React + Vite front-end written in TypeScript
- 🧠 Configurable instructions, model, temperature, and optional reasoning effort controls
- 🔁 Persistent multi-turn conversation history and last response ID storage for `previous_response_id` chaining
- 📊 Token usage insights showing input, output, cached, and reasoning tokens from the Responses API
- 🧱 Express proxy server that keeps your OpenAI API key safely on the backend while forwarding to the Responses API
- 🌗 Responsive, modern UI with thoughtful empty and loading states
- 🛠️ Rich tooling panel to configure MCP servers, function calls, file search, web search, code interpreter, image generation, and custom tools with tool choice controls
- 🔍 Tool call inspector that summarizes function, search, MCP, and image results inline with each assistant reply

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the `.env.example` file and add your OpenAI API key:

```bash
cp .env.example .env
# then edit .env and add your OpenAI API key
```

> **Important**: The key is only ever used on the server. Never expose it directly to the browser.

### 3. Run the development servers

Start the Express API server and Vite dev server concurrently:

```bash
npm run dev
```

- The React client runs at http://localhost:5173
- API requests are proxied to the Express server at http://localhost:3001 via `/api`

### 4. Build for production

```bash
npm run build
```

The compiled assets will be output to the `dist/` directory. To serve the production bundle alongside the API:

```bash
npm run start
```

The Express server serves static assets from `dist/` when `NODE_ENV=production`.

## Project structure

```
.
├── index.html          # Vite entry point
├── server/             # Express server for OpenAI proxying
│   └── index.ts
├── src/
│   ├── App.tsx         # Chat UI and client-side logic
│   ├── App.css         # Component styling
│   ├── index.css       # Global styles
│   ├── main.tsx        # React entry
│   └── types.ts        # Shared TypeScript types
├── package.json
├── tsconfig*.json
└── README.md
```

## API notes

The `POST /api/respond` endpoint expects the payload shown below. The Express server validates the input, forwards it to `openai.responses.create`, and returns the aggregated output text plus usage information.

```jsonc
{
  "messages": [
    { "role": "user", "content": "Hello there!" }
  ],
  "model": "gpt-5",
  "temperature": 0.7,
  "instructions": "You are a helpful assistant.",
  "reasoningEffort": "medium", // optional – forwarded for gpt-5 and o-series models
  "previousResponseId": "resp_123..." // optional – include after the first turn to chain context
}
```

- `temperature` is applied for models that support it. The server omits it for gpt-5 and o-series models, which reject sampling parameters.
- `instructions` maps directly to the Responses API instructions field so you can steer tone and behaviour per request.
- `previousResponseId` should be the `id` returned from the last response so the server can pass `previous_response_id` and maintain conversation state without resending the entire history.
- The client persists the last response ID locally and only sends the newest user message each turn; the server fallbacks to full history if necessary for backwards compatibility.

## Useful references

- [OpenAI API Reference – Responses](https://platform.openai.com/docs/api-reference/responses)
- [OpenAI documentation](https://platform.openai.com/docs)

---

Enjoy experimenting with the Responses API! ✨

# MCP Client Demo

This is a demo project for a client using the Model Context Protocol (MCP), designed to demonstrate how to interact with AI models via MCP and utilize model tool calling features.

## Features

- Connect to MCP server
- Call large language models (LLM) for conversation (in this example, `qwen3-235b-a22b` is used)
- Support for Custom Tool Calling
- Streaming response handling

## Prerequisites

- Node.js (v18+)
- TypeScript
- DashScope API key

## Installation

```bash
# Clone the project
git clone https://github.com/obrr-hhx/mcp-client-demo.git
cd mcp-client-demo

# Install dependencies
npm install
```

## Configuration

1. Create a `.env` file and add the following content:

```
DASHSCOPE_API_KEY=your_dashscope_api_key
```

2. Configure the server connection (already set in `server-config.json`):

Since this demo only implements connections via sse and streamable http, if you are using an mcp server with stdio, please use the [mcp-proxy](https://github.com/sparfenyuk/mcp-proxy) project as a proxy first.

The demo uses a filesystem mcp server. Example command:

`mcp-proxy --port=9000 -- npx -y @modelcontextprotocol/server-filesystem /path/to/your/workspace`

Example server-config.json:

```json
{
    "mcp-proxy-filesystem": {
        "url": "http://127.0.0.1:9000/sse"
    }
}
```

## Build

```bash
npm run build
```

## Usage

```bash
node build/index.js
```

After starting, follow the prompts to interact with the AI assistant. Enter `exit` to quit the program.

## Project Structure

```
├── src/
│   ├── index.ts          # Program entry point
│   ├── mcpHost.ts        # MCP host class, handles interaction with LLM
│   ├── mcpClient.ts      # MCP client, connects to MCP server
│   └── tools.ts          # Tool calling related definitions
├── server-config.json    # Server configuration
└── tsconfig.json         # TypeScript configuration
```

## License

MIT 
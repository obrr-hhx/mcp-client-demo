import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { FunctionTool } from "openai/src/resources/responses/responses.js"
import { URL } from "url";

export class MCPClient {
    private client: Client;
    private transport: Transport | null = null;
    private isConnected = false;

    constructor(serverName: string) {
        this.client = new Client({
            name: `mcp-client-for-${serverName}`,
            version: "1.0.0"
        })    
    }

    async connectToServer(serverUrl: string) {
        const url = new URL(serverUrl);
        try {
            this.transport = new StreamableHTTPClientTransport(url);
            await this.client.connect(this.transport);
        } catch (error) {
            console.log('[mcpClient] Streamable HTTP connection failed, falling back to SSE transport');
            this.transport = new SSEClientTransport(url);
            await this.client.connect(this.transport);
        }
        
        console.log(`[mcpClient] connected to server successfully`);
        this.isConnected = true;
    }
    
    async getTools(): Promise<FunctionTool[]> {
        if (!this.isConnected) {
            console.error(`[mcpClient] failed to get tool list when not connected to server`);
            throw new Error("not connected to server");
        }
        try {
            const toolsResult = await this.client.listTools();
            
            const tools: FunctionTool[] = toolsResult.tools.map((tool) => {
                return {
                    type: 'function',
                    strict: true,
                    name: tool.name,
                    description: tool.description,
                    parameters: {
                        ... tool.inputSchema,
                        additionalProperties: false
                    },
                }
            });
            console.log(`[mcpClient] converted tool number: ${tools.length}`);
            return tools;
        } catch (error) {
            console.error(`[mcpClient] failed to get tool list: ${error}`);
            throw error;
        }
    }

    async callTool(name: string, args: { [x: string]: unknown }) {
        if (!this.isConnected) {
            console.error(`[mcpClient] failed to call tool ${name} when not connected to server`);
            throw new Error("not connected to server");
        }

        console.log(`[mcpClient] calling tool ${name}`);
        try {
            
            const result = await this.client.callTool({
                name: name,
                arguments: args,
            });
            
            return result;
        } catch (error) {
            console.error(`[mcpClient] failed to call tool ${name}: ${error}`);
            throw error;
        }
    }

    async cleanup() {
        await this.client.close();
        this.isConnected = false;
    }
}
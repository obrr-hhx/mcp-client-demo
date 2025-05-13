import dotenv from "dotenv"
import OpenAI from 'openai'
import { FunctionTool, ResponseInput } from "openai/src/resources/responses/responses.js"
import { MCPClient } from "./mcpClient.js";
import { toolCall } from "./tools.js";
import configs from "../server-config.json" with { type: "json" }

dotenv.config();

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
if(!DASHSCOPE_API_KEY) {
    throw new Error("DASHSCOPE_API_KEY is not set");
}

type SSEServerConfig = {
    url: string;
}

export class MCPHost {
    private mcps: MCPClient[] = [];
    private tools: FunctionTool[] = [];
    private toolsMap: {[name:string]:MCPClient} = {};

    private servers: {[name: string]: SSEServerConfig} = configs;
    private openai: OpenAI;
    private model: string = "qwen3-235b-a22b";

    constructor() {
        this.openai = new OpenAI({
            apiKey: DASHSCOPE_API_KEY,
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
        });
    }

    async connectToServers() {
        try {
            console.log("[mcpHost] connecting to servers...");
            for (const serverName in this.servers) {
                try {
                    console.log(`[mcpHost] trying to connect to server: ${serverName} (${this.servers[serverName].url})`);
                    const mcp = new MCPClient(serverName);
                    await mcp.connectToServer(this.servers[serverName].url);
                    this.mcps.push(mcp);
                    
                    const tools = await mcp.getTools();
                    const map: {[name: string]: MCPClient} = {};
                    tools.forEach((t) => map[t.name] = mcp);
                    this.tools = [...this.tools, ...tools];
                    this.toolsMap = {...this.toolsMap, ...map};
                    console.log(`[mcpHost] successfully connected to server ${serverName} and get tools: ${tools.map(({ name }) => name).join(", ")}`);
                } catch (err) {
                    console.error(`[mcpHost] failed to connect to server ${serverName}:`, err);
                }
            }
            
            if (this.mcps.length === 0) {
                throw new Error("[mcpHost] failed to connect to any server");
            }
            
            console.log(`[mcpHost] connected to ${this.mcps.length} servers, ${this.tools.length} tools available`);
        } catch (error) {
            console.error("[mcpHost] server connection failed:", error);
            throw error;
        }
    }

    async getResponse(messages: any[]) {
        // make FunctionTool to ChatCompletionTool
        const formattedTools = this.tools.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description || "",
                parameters: tool.parameters || {}
            }
        }));

        // use any type to bypass type check error
        const requestOptions: any = {
            model: this.model,
            messages: messages,
            enable_thinking: true,
            tools: formattedTools,
            stream: true,
            parallel_tool_calls: true
        };

        console.log("[mcpHost] requesting LLM, please wait...");
        // use any type to bypass type check error
        return await this.openai.chat.completions.create(requestOptions) as any;
    }

    async startChat(query: string, messages: any[] = []) {
        // add user message
        messages.push({
            role: "user",
            content: query,
        });

        let stream;
        try {
            stream = await this.getResponse(messages);
        } catch (error) {
            console.error("[mcpHost] get LLM response error:", error);
            return;
        }

        let reasoningContent = "";
        let answerContent = "";
        let isAnswering = false;
        let isToolCall = false;
        let toolCalls:toolCall[] = [];
        let toolName:string = "";
        try {
            console.log("\n" + "=".repeat(20) + "LLM is thinking..." + "=".repeat(20));
            for await (const chunk of stream) {
                try {
                    if (!chunk.choices?.length) {
                        if (chunk.usage) {
                            console.log("\n" + "=".repeat(20) + "usage statistics" + "=".repeat(20));
                            console.log(JSON.stringify(chunk.usage, null, 2));
                        }
                        continue;
                    }

                    const delta = chunk.choices[0]?.delta;
                    if (!delta) continue;

                    // handle thinking process
                    if ((delta as any).reasoning_content) {
                        const content = (delta as any).reasoning_content;
                        reasoningContent += content;
                        process.stdout.write(content);
                    } else { // handle answer content
                        if (!isAnswering) {
                            isAnswering = true;
                            console.log("\n" + "=".repeat(20) + "LLM Answer" + "=".repeat(20));
                        }
                        if (delta.content) {
                            answerContent += delta.content;
                            process.stdout.write(delta.content);
                        }
                    }
                    
                    // handle tool call (streaming message, tool information needs to be concatenated)
                    if(delta.finish_reason == "tool_calls") continue;
                    
                    if (delta.tool_calls && delta.tool_calls.length > 0) {
                        if(!isToolCall){
                            isToolCall = true;
                            console.log("\n" + "=".repeat(20) + "LLM Tool Call" + "=".repeat(20));
                        }
                        for (const tool_call of delta.tool_calls) {
                            if(tool_call.function.name != "" && tool_call.function.name != null){
                                toolName = tool_call.function.name;
                                toolCalls.push({
                                    index: tool_call.index,
                                    id: tool_call.id,
                                    name: toolName,
                                    args: tool_call.function.arguments
                                });
                            }else{
                                toolCalls[toolCalls.length-1].args += tool_call.function.arguments==null?"":tool_call.function.arguments;
                            }
                        }
                    }
                } catch (err) {
                    console.error("[mcpHost] process response block error:", err);
                }
            }
            console.log("[mcpHost] tool call information: \n", toolCalls);
            // execute tool call
            let assistantToolCallsMessages:any[] = [];
            let toolCallsMessages:any[] = [];
            for(let i = 0; i < toolCalls.length; i++){
                toolName = toolCalls[i].name;
                let toolArg = JSON.parse(toolCalls[i].args);
                const mcpClient = this.toolsMap[toolName];

                if(!mcpClient) {
                    console.warn(`[mcpHost] tool not found: ${toolName}`);
                    continue;
                }

                console.log(`\n[mcpHost] calling tool: ${toolName}]`);
                console.log(`[mcpHost] parameters: ${JSON.stringify(toolArg, null, 2)}]`);
                
                let result;
                try {
                    result = await mcpClient.callTool(toolName, toolArg);
                } catch (err: unknown) {
                    console.error(`[mcpHost] tool call failed ${toolName}:`, err);
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    result = { error: `tool call failed: ${errorMessage}` };
                }

                // create assistant message
                const assistantToolCallsMessage = toolCalls.map((tc: toolCall) => ({
                    id: tc.id,
                    type: "function",
                    function: {
                        name: tc.name || "",
                        arguments: tc.args || "{}"
                    },
                    index: tc.index
                }));
                assistantToolCallsMessages.push(...assistantToolCallsMessage);
                // add tool response message
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                
                toolCallsMessages.push({
                    role: "tool",
                    content: resultStr,
                    tool_call_id: toolCalls[i].id
                });
                
                console.log(`[mcpHost] tool result: ${resultStr}`);
            }
            
            /* the assistant message should be like this:
            {
                "content": "",
                "refusal": None,
                "role": "assistant",
                "audio": None,
                "function_call": None,
                "tool_calls": [
                    {
                        "id": "call_xxx",
                        "function": {
                            "arguments": '{"location": "上海"}',
                            "name": "get_current_weather",
                        },
                        "type": "function",
                        "index": 0,
                    }
                ],
            }
            */
            messages.push({
                role: "assistant",
                content: "",
                tool_calls: assistantToolCallsMessages
            });
            messages.push(...toolCallsMessages);

            try {
                console.log("\n" + "=".repeat(20) + "LLM Answer after tool call" + "=".repeat(20));
                const completion = await this.openai.chat.completions.create({
                    model: this.model,
                    messages: messages,
                });
                const responseContent = completion.choices[0].message.content ?? "";
                answerContent += responseContent;
                process.stdout.write(responseContent);
            } catch (err) {
                console.error("[mcpHost] get LLM response after tool call error:", err);
            }

            console.log("\n" + "=".repeat(20) + "Dialogue END" + "=".repeat(20));
        } catch (error) {
            console.error("[mcpHost] dialogue error:", error);
        }
    }
    
    async cleanup() {
        console.log("[mcpHost] cleaning up connection resources...");
        try {
            for (const mcp of this.mcps) {
                await mcp.cleanup();
            }
            console.log("[mcpHost] connection resources cleaned up");
        } catch (err: any) {
            console.error("[mcpHost] clean up connection resources failed:", err);
        }
    }
}

import dotenv from "dotenv"
import OpenAI from 'openai'
import { ChatCompletionTool } from "openai/resources/chat/completions";
import { MCPClient } from "./mcpClient.js";
import { toolCall, customTools, CustomToolExecutor } from "./tools.js";
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
    private customToolExecutor: CustomToolExecutor;
    private tools: ChatCompletionTool[] = [];
    private toolsMap: {[name:string]:MCPClient} = {};

    private servers: {[name: string]: SSEServerConfig} = configs;
    private openai: OpenAI;
    private model: string = "qwen3-235b-a22b";

    constructor() {
        this.openai = new OpenAI({
            apiKey: DASHSCOPE_API_KEY,
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
        });
        this.customToolExecutor = new CustomToolExecutor(customTools);
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
                    tools.forEach((t) => map[t.function.name] = mcp);
                    this.tools = [...this.tools, ...tools];
                    this.toolsMap = {...this.toolsMap, ...map};
                    console.log(`[mcpHost] successfully connected to server ${serverName} and get tools: ${tools.map((t) => t.function.name).join(", ")}`);
                } catch (err) {
                    console.error(`[mcpHost] failed to connect to server ${serverName}:`, err);
                }
            }
            await this.loadCustomTools();
            if (this.mcps.length === 0) {
                throw new Error("[mcpHost] failed to connect to any server");
            }
            
            console.log(`[mcpHost] connected to ${this.mcps.length} servers, ${this.tools.length} tools available`);
        } catch (error) {
            console.error("[mcpHost] server connection failed:", error);
            throw error;
        }
    }
    async loadCustomTools() {
        this.tools = [...this.tools, ...customTools];
        console.log("[mcpHost] custom tools:", customTools.map((t) => t.function.name));
    }

    async getResponse(messages: any[]) {
        // use any type to bypass type check error
        const requestOptions: any = {
            model: this.model,
            messages: messages,
            enable_thinking: true,
            tools: this.tools,
            stream: true,
            parallel_tool_calls: true
        };

        // use any type to bypass type check error
        return await this.openai.chat.completions.create(requestOptions) as any;
    }

    async startChat(query: string, messages: any[] = []) {
        // add user message
        messages.push({
            role: "user",
            content: query,
        });

        let isThinking = false;
        let isAnswering = false;
        let isToolCall = false;
        
        while(!isAnswering){
            let reasoningContent = "";
            let answerContent = "";
            let stream;
            let toolCalls:toolCall[] = [];
            let toolName:string = "";
            try {
                stream = await this.getResponse(messages);
            } catch (error) {
                console.error("[mcpHost] get LLM response error:", error);
                return;
            }
            try {
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
                            if (!isThinking) {
                                isThinking = true;
                                console.log("\n" + "=".repeat(20) + "LLM Thinking" + "=".repeat(20));
                            }
                            const content = (delta as any).reasoning_content;
                            reasoningContent += content;
                            process.stdout.write(content);
                        } else { // handle answer content
                            if (delta.content) {
                                if (!isAnswering) {
                                    isAnswering = true;
                                    console.log("\n" + "=".repeat(20) + "LLM Answer" + "=".repeat(20));
                                }
                                answerContent += delta.content;
                                process.stdout.write(delta.content);
                            }
                        }
                        
                        // handle tool call (streaming message, tool information needs to be concatenated)
                        if(delta.finish_reason == "tool_calls") continue;
                        
                        if (delta.tool_calls && delta.tool_calls.length > 0) {
                            // if(!isToolCall){
                            //     isToolCall = true;
                            //     console.log("\n" + "=".repeat(20) + "LLM Tool Call" + "=".repeat(20));
                            // }
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
                // console.log("[mcpHost] tool call information: \n", toolCalls);
                // execute tool call
                let assistantToolCallsMessages:any[] = [];
                let toolCallsMessages:any[] = [];
                for(let i = 0; i < toolCalls.length; i++){
                    toolName = toolCalls[i].name;
                    let toolArg = JSON.parse(toolCalls[i].args);
                    const mcpClient = this.toolsMap[toolName];

                    if(!mcpClient && !this.customToolExecutor.isCustomTool(toolName)) {
                        console.log(`[mcpHost] tool's mcp client not found: ${toolName}`);
                        continue;
                    }

                    console.log(`\n[mcpHost] calling tool: ${toolName}]`);
                    console.log(`[mcpHost] parameters: ${JSON.stringify(toolArg, null, 2)}]`);
                    
                    let result;
                    try {
                        if(this.customToolExecutor.isCustomTool(toolName)){
                            result = await this.customToolExecutor.executeTool(toolName, toolArg);
                        }else{
                            result = await mcpClient.callTool(toolName, toolArg);
                        }
                    } catch (err: unknown) {
                        console.error(`[mcpHost] tool call failed ${toolName}:`, err);
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        result = { error: `tool call failed: ${errorMessage}` };
                    }

                    // create assistant message
                    for (let j = 0; j < toolCalls.length; j++) {
                        const tc = toolCalls[j];
                        assistantToolCallsMessages.push({
                            id: tc.id,
                            type: "function",
                            function: {
                                name: tc.name || "",
                                arguments: tc.args || "{}"
                            },
                            index: tc.index
                        });
                    }
                    
                    // add tool response message
                    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                    
                    toolCallsMessages.push({
                        role: "tool",
                        content: resultStr,
                        tool_call_id: toolCalls[i].id
                    });
                    
                    // console.log(`[mcpHost] tool result: ${resultStr}`);
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
                content: "<think>" + reasoningContent + "</think>" + answerContent,
               })
               if(assistantToolCallsMessages.length > 0){
                    messages.push({
                        role: "assistant",
                        content: "",
                        tool_calls: assistantToolCallsMessages
                    });
                    messages.push(...toolCallsMessages);
                }
                messages.push({
                    role: "user",
                    content: "pls use user's language to answer the question, if the user's language is not chinese, pls translate the answer to user's language"
                });
            } catch (error) {
                console.error("[mcpHost] dialogue error:", error);
            }
        }
        console.log("\n" + "=".repeat(20) + "Dialogue END" + "=".repeat(20));
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

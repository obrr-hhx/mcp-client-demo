import { ChatCompletionTool } from "openai/resources/chat/completions";
import { v4 as uuidv4 } from 'uuid';

export type toolCall = {
    index: number;
    id: string;
    name: string;
    args: string;
};

const taskCompletionTool: ChatCompletionTool = {
    type: "function",
    function: {
        name: "task_complete",
        description: "Call this tool when the task given by the user is complete",
        parameters: {
            type: "object",
            properties: {},
        },
    },
};
const askQuestionTool: ChatCompletionTool = {
    type: "function",
    function: {
        name: "ask_question",
        description: "Ask a question to the user to get more info required to solve or clarify their problem.",
        parameters: {
            type: "object",
            properties: {},
        },
    },
};

const webSearchTool: ChatCompletionTool = {
    type: "function",
    function: {
        name: "web_search",
        description: "Search the web for information",
        parameters: {
            type: "object",
            properties: {
                search_engine: {
                    type: "string",
                    description: "The search engine to use, the search_std is Zhipu basic search engine, search_pro is Zhipu advanced search engine, search_pro_sogou is Sogou search engine, search_pro_quark is Quark search engine, search_pro_jina is Jina search engine, search_pro_bing is Bing search engine",
                    enum: ["search_std", "search_pro", "search_pro_sogou", "search_pro_quark", "search_pro_jina", "search_pro_bing"],
                },
                search_query: {
                    type: "string",
                    description: "The content to search for, the search query should not exceed 78 characters, must in 中文"
                }
            },
            required: ["search_engine", "search_query"]
        },
    },
};

const customTools = [taskCompletionTool, askQuestionTool, webSearchTool];

export { taskCompletionTool, askQuestionTool, webSearchTool, customTools };

const user_id = uuidv4();

async function webSearch(toolArg: any) {
    const http_endpoint = "https://open.bigmodel.cn/api/paas/v4/web_search";
    const api_key = process.env.ZHIPU_API_KEY;
    if(!api_key) {
        throw new Error("ZHIPU_API_KEY is not set");
    }

    toolArg["request_id"] = toolArg["request_id"] || uuidv4();
    toolArg["user_id"] = user_id;
    
    // console.log("[webSearch] toolArg:", toolArg);

    const response = await fetch(http_endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${api_key}`
        },
        body: JSON.stringify(toolArg)
    });
    const data = await response.json();
    data["answer_require"] = "when you give web search answer to user, keep in mind you need attach the link"
    return data;
}

async function askQuestion(toolArg: any) {
    // make user answer the question
    // show the question to user
    process.stdout.write(toolArg["question"]);
    // get the answer from user
    const answer = await new Promise<string>((resolve) => {
        process.stdin.once("data", (data) => {
            resolve(data.toString().trim());
        });
    });
    // return the answer
    return answer;
}

async function taskComplete() {
    return "task complete, don't need to call any tools, just answer";
}

export class CustomToolExecutor {
    private tools: ChatCompletionTool[] = [];
    private toolsMap: {[name: string]: Function} = {};
    
    constructor(tools: ChatCompletionTool[]) {
        this.tools = tools;
        this.toolsMap["web_search"] = webSearch;
        this.toolsMap["ask_question"] = askQuestion;
        this.toolsMap["task_complete"] = taskComplete;
    }

    isCustomTool(toolName: string) {
        return this.toolsMap[toolName] ? true : false;
    }

    async executeTool(toolName: string, toolArg: any) {
        if(this.toolsMap[toolName]) {
            return await this.toolsMap[toolName](toolArg);
        }
        return null;
    }
};
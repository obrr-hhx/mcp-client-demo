import { ChatCompletionTool } from "openai/resources/chat/completions";

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
const exitLoopTools = [taskCompletionTool, askQuestionTool];

export { taskCompletionTool, askQuestionTool, exitLoopTools };
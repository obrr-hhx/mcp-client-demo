import readline from "readline/promises"
import { MCPHost } from "./mcpHost.js";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    const mcpHost = new MCPHost();
    try {
        await mcpHost.connectToServers();
        
        const messages: any[] = [];
        let running = true;
        
        while (running) {
            try {
                const query = await rl.question("\ninput your question (enter 'exit' to quit): ");
                if (query.toLowerCase() === 'exit') {
                    console.log("Thank you for using, goodbye!");
                    running = false;
                    break;
                }
                
                await mcpHost.startChat(query, messages);
            } catch (error) {
                console.error("Dialogue error:", error);
                console.log("You can continue to input questions, or enter 'exit' to quit");
            }
        }
    } catch (error) {
        console.error("Program error:", error);
    } finally {
        await mcpHost.cleanup();
        rl.close();
    }
}

main();
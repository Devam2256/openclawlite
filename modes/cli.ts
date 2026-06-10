import chalk from "chalk";
import { select, isCancel } from "@clack/prompts";
import { runAgentMode } from "./agent/orchestrator";
import { runAskMode } from "./ask/orchestrator";
import { runPlanMode } from "./plan/orchestrator";
import { runShoppingMode } from "./shopping/cli-shopping.ts";

export async function runCliMode() {
  while (true) {
    const mode = await select({
      message: chalk.bold.cyan("Choose a CLI sub-mode to proceed:"),
      options: [
        { value: "agent", label: "🤖 Agent Mode", hint: "Let the AI write code and execute tools" },
        { value: "plan", label: "🧭 Plan Mode", hint: "Create and run a step-by-step goal plan" },
        { value: "ask", label: "❓ Ask Mode", hint: "Ask questions and research your codebase" },
        { value: "shopping", label: "🛍️ Shopping Mode", hint: "Find and compare best online prices in India" },
      ],
    });

    if (isCancel(mode)) return;

    try {
      if (mode === "agent") {
        await runAgentMode();
      }
      if (mode === "ask") {
        await runAskMode();
      }
      if (mode === "plan") {
        await runPlanMode();
      }
      if (mode === "shopping") {
        await runShoppingMode();
      }
    } catch (err: any) {
      console.error(chalk.red(`\nError in ${mode} mode: ${err.message}\n`));
    }

    // Loop continues — agent keeps running after task completion
    console.log(chalk.dim("\n─────────────────────────────────────\n"));
  }
}
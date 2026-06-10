// modes/agent/orchestrator.ts (runAgentMode — CLI version, fixed)
import { isCancel, text, confirm } from "@clack/prompts";
import chalk from "chalk";
import { defaultAgentConfig } from "./types";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { stepCountIs, ToolLoopAgent } from "ai";
import { getAgentModel } from "../../ai";
import { renderTerminalMarkdown } from "../../tui/terminal-md";
import { runApprovalFlow } from "./approval";

export async function runAgentMode() {
  console.log(
    chalk.cyan(
      `\n══════════════════════════════════════════════════════════════════\n` +
      `  🤖  ${chalk.bold("AGENT MODE")} — Let AI modify your codebase\n` +
      `════════════════════════════════════════════════════════════════════\n`
    )
  );

  const config = defaultAgentConfig();

  const approvePath = await confirm({
    message: `Target workspace: ${chalk.cyan(config.codebasePath)}\n  Proceed with this workspace?`,
    initialValue: true,
  });

  if (isCancel(approvePath) || !approvePath) {
    console.log(chalk.dim("\nAgent mode cancelled.\n"));
    return;
  }

  const goal = await text({
    message: "What would you like the agent to do?",
    placeholder: "Concrete task for this codebase…",
  });

  if (isCancel(goal) || !goal?.trim()) return;

  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const tools = createAgentTools(executor);

  console.log(chalk.cyan("\n🤖 Agent running...\n"));

  let agentText = "";

  try {
    const agent = new ToolLoopAgent({
      model: getAgentModel(),
      stopWhen: stepCountIs(40),
      instructions: [
        `Workspace root: ${config.codebasePath}`,
        "All mutations are staged until approval.",
      ].join("\n"),
      tools,
    });

    const result = await agent.generate({
      prompt: goal.trim(),
      onStepFinish: ({ toolCalls }) => {
        for (const tc of toolCalls) {
          const preview = JSON.stringify(tc.input).slice(0, 160);
          console.log(
            chalk.green("  ✓"),
            chalk.bold(String(tc.toolName)),
            chalk.dim(preview + (preview.length >= 160 ? "..." : ""))
          );
        }
      },
    });

    agentText = result.text?.trim() ?? "";
  } catch (err: any) {
    console.error(chalk.red(`\n❌ Agent error: ${err.message}\n`));

    // Check if there are any staged changes to salvage
    const pending = tracker.pendingMutations();
    if (pending.length > 0) {
      console.log(
        chalk.yellow(
          `⚠️  The agent failed but left ${pending.length} staged change(s).\n`
        )
      );
      const salvage = await confirm({
        message: "Would you like to review and apply the partial changes?",
        initialValue: false,
      });

      if (isCancel(salvage) || !salvage) {
        executor.clearStaging();
        console.log(chalk.dim("\nStaged changes discarded.\n"));
        return;
      }
      // Fall through to approval flow with partial changes
    } else {
      executor.clearStaging();
      return;
    }
  }

  if (agentText) {
    console.log("\n" + renderTerminalMarkdown(agentText) + "\n");
  }

  // Approval flow
  const approved = await runApprovalFlow(tracker);

  if (!approved) {
    executor.clearStaging();
    console.log(chalk.dim("No changes applied.\n"));
    return;
  }

  const { errors } = executor.applyApprovedFromTracker();
  executor.clearStaging();

  if (errors.length > 0) {
    console.log(chalk.yellow(`\n⚠️  Applied with ${errors.length} error(s):\n`));
    for (const e of errors) console.log(chalk.red(`  • ${e}`));
  } else {
    console.log(chalk.green("\n✓ All approved changes applied.\n"));
  }
}

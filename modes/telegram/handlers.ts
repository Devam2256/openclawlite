// modes/telegram/handlers.ts
import { Markup, type Telegraf } from "telegraf";
import { isOwner } from "./auth";
import { WELCOME } from "./constants";
import { clip, commandArg } from "./text";
import { runAgent, runAsk, runPlanSteps } from "./agent-run";
import { defaultAgentConfig } from "../agent/types";
import { generatePlan } from "../plan/planner";
import {
  planKeyboard,
  planMessage,
  planSessions,
  refreshPlanUi,
  type PlanSession,
} from "./plan-session";
import {
  approvalDiff,
  approvalSessions,
  finishOrApprove,
  perFileMessage,
  perFileKeyboard,
} from "./approval-session";
import {
  handleShoppingCommand,
  handleQuestionReply,
  hasQuestionSession,
} from "../shopping/index.ts";

export function registerHandlers(bot: Telegraf) {
  const pendingAgentGoals = new Map<number, string>();

  // ─── Basic commands ───────────────────────────────────────────────────────

  bot.command("start", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    await ctx.reply(WELCOME, { parse_mode: "Markdown" });
  });

  bot.command("shopping", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    await handleShoppingCommand(ctx);
  });

  bot.command("ask", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const q = commandArg(ctx.message.text, "ask");
    if (!q)
      return ctx.reply(
        "⚠️ *Usage:* `/ask <your question>`\n\nExample:\n`/ask How does the scraper handle rate limits?`",
        { parse_mode: "Markdown" }
      );

    await ctx.reply("🔍 *Researching your question...* Please wait.", {
      parse_mode: "Markdown",
    });
    void runAsk(ctx, q).catch(console.error);
  });

  // ─── Agent ────────────────────────────────────────────────────────────────

  bot.command("agent", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const goal = commandArg(ctx.message.text, "agent");
    if (!goal)
      return ctx.reply(
        "⚠️ *Usage:* `/agent <task description>`\n\nExample:\n`/agent Refactor the logging utility to include timestamps`",
        { parse_mode: "Markdown" }
      );

    const config = defaultAgentConfig();
    pendingAgentGoals.set(ctx.chat.id, goal);

    await ctx.reply(
      `🤖 *Agent Mode Confirmation*\n\n` +
        `📁 *Workspace:* \`${config.codebasePath}\`\n` +
        `📝 *Task:* _${goal}_\n\n` +
        `Do you want to proceed in this workspace?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Proceed", "agent_proceed"),
            Markup.button.callback("❌ Cancel", "agent_cancel"),
          ],
        ]),
      }
    );
  });

  bot.action("agent_proceed", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const goal = pendingAgentGoals.get(ctx.chat!.id);
    if (!goal) {
      await ctx.editMessageText("❌ No active agent task found.");
      return ctx.answerCbQuery();
    }
    pendingAgentGoals.delete(ctx.chat!.id);
    await ctx.editMessageText(`🤖 *Agent Mode started:*\n_${goal}_`, {
      parse_mode: "Markdown",
    });
    await ctx.answerCbQuery("Started!");
    void runAgent(ctx, ctx.chat!.id, goal).catch(async (err) => {
      console.error(err);
      // Clean up approval session if agent crashes mid-run
      approvalSessions.delete(ctx.chat!.id);
      await ctx.reply(
        "❌ Agent encountered an unexpected error and stopped.\n\nAll staged changes have been discarded."
      );
    });
  });

  bot.action("agent_cancel", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    pendingAgentGoals.delete(ctx.chat!.id);
    await ctx.editMessageText("❌ Agent task cancelled.");
    await ctx.answerCbQuery("Cancelled");
  });

  // ─── Approval — Accept / Reject All ──────────────────────────────────────

  bot.action("approval_diff", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery("No active session");
    await ctx.answerCbQuery();
    const diffText = approvalDiff(s.pending);
    // Send in chunks if too long
    const chunks = chunkText(diffText, 3500);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    }
  });

  bot.action("approval_accept", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery("No active session");

    approvalSessions.delete(ctx.chat!.id);
    for (const a of s.pending) s.tracker.updateStatus(a.id, "approved", true);

    const { errors } = s.executor.applyApprovedFromTracker();
    s.executor.clearStaging();

    if (errors.length > 0) {
      await ctx.editMessageText(
        `⚠️ *Changes applied with ${errors.length} error(s):*\n\n${errors.map((e) => `• ${e}`).join("\n")}`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.editMessageText("✅ All changes applied successfully.");
    }
    await ctx.answerCbQuery("Applied!");
  });

  bot.action("approval_reject", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery("No active session");

    approvalSessions.delete(ctx.chat!.id);
    for (const a of s.pending) s.tracker.updateStatus(a.id, "rejected", false);
    s.executor.clearStaging();

    await ctx.editMessageText(
      "❌ All changes rejected. Nothing was applied."
    );
    await ctx.answerCbQuery("Rejected");
  });

  bot.action("approval_cancel", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery("No active session");

    approvalSessions.delete(ctx.chat!.id);
    for (const a of s.pending) s.tracker.updateStatus(a.id, "rejected", false);
    s.executor.clearStaging();

    await ctx.editMessageText("🚫 Review cancelled. All changes discarded.");
    await ctx.answerCbQuery("Cancelled");
  });

  // ─── Approval — Per-file review ───────────────────────────────────────────

  bot.action("approval_per_file", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery("No active session");

    s.perFileMode = true;
    s.reviewIndex = 0;
    s.decisions = new Map();

    await ctx.editMessageText(perFileMessage(s), {
      parse_mode: "Markdown",
      ...perFileKeyboard(s),
    });
    await ctx.answerCbQuery();
  });

  bot.action("approval_file_diff", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s || !s.perFileMode) return ctx.answerCbQuery("No active session");

    const group = s.groups[s.reviewIndex];
    if (!group?.patch) {
      await ctx.answerCbQuery("No diff available for this change");
      return;
    }

    await ctx.answerCbQuery();
    const diffHtml = `<b>${group.label}</b>\n\n${colorDiffForTelegramInline(group.patch)}`;
    const chunks = chunkText(diffHtml, 3500);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    }
  });

  bot.action("approval_file_accept", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s || !s.perFileMode) return ctx.answerCbQuery("No active session");

    const group = s.groups[s.reviewIndex]!;
    for (const id of group.actionIds) {
      s.decisions.set(id, "approved");
    }

    await ctx.answerCbQuery("✅ Accepted");
    await advancePerFileReview(ctx, s);
  });

  bot.action("approval_file_reject", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s || !s.perFileMode) return ctx.answerCbQuery("No active session");

    const group = s.groups[s.reviewIndex]!;
    for (const id of group.actionIds) {
      s.decisions.set(id, "rejected");
    }

    await ctx.answerCbQuery("❌ Rejected");
    await advancePerFileReview(ctx, s);
  });

  // ─── Plan ─────────────────────────────────────────────────────────────────

  bot.command("plan", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const goal = commandArg(ctx.message.text, "plan");

    if (!goal)
      return ctx.reply(
        "⚠️ *Usage:* `/plan <your goal>`\n\nExample:\n`/plan Add a cache layer for API requests`",
        { parse_mode: "Markdown" }
      );

    await ctx.reply("🧭 *Generating a plan...* Analyzing your goal.", {
      parse_mode: "Markdown",
    });

    void (async () => {
      const plan = await generatePlan(goal);
      const session: PlanSession = {
        plan,
        selected: new Set(plan.steps.map((s) => s.id)),
      };
      await ctx.reply(planMessage(session), {
        parse_mode: "Markdown",
        ...planKeyboard(session),
      });
      planSessions.set(ctx.chat.id, session);
    })().catch(console.error);
  });

  bot.action(/^plan_toggle:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    const id = ctx.match[1]!;
    if (s.selected.has(id)) s.selected.delete(id);
    else s.selected.add(id);
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  bot.action("plan_all", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    for (const step of s.plan.steps) s.selected.add(step.id);
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  bot.action("plan_none", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    s.selected.clear();
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  bot.action("plan_proceed", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    const steps = s.plan.steps.filter((step) => s.selected.has(step.id));
    if (steps.length === 0) return ctx.answerCbQuery();

    const { plan } = s;
    planSessions.delete(ctx.chat!.id);
    const list = steps.map((step, i) => `${i + 1}. ${step.title}`).join("\n");
    await ctx.editMessageText(
      `🚀 *Executing ${steps.length} step(s)...*\n\n${list}`,
      { parse_mode: "Markdown" }
    );
    await ctx.answerCbQuery();
    void runPlanSteps(ctx, ctx.chat!.id, plan, steps).catch(console.error);
  });

  // ─── Message router ───────────────────────────────────────────────────────

  bot.on("message", async (ctx, next) => {
    if (!isOwner(ctx.chat!.id)) return;
    const text =
      ctx.message && "text" in ctx.message ? ctx.message.text : "";
    if (!text || text.startsWith("/")) return next();

    const chatId = ctx.chat!.id;

    if (hasQuestionSession(chatId)) {
      await handleQuestionReply(ctx);
      return;
    }

    return next();
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Advance to next file in per-file review.
 * If all files reviewed, apply decisions and finish.
 */
async function advancePerFileReview(ctx: any, s: any) {
  s.reviewIndex++;

  if (s.reviewIndex < s.groups.length) {
    // More files to review
    await ctx.editMessageText(perFileMessage(s), {
      parse_mode: "Markdown",
      ...perFileKeyboard(s),
    });
    return;
  }

  // All files reviewed — apply decisions
  const chatId = ctx.chat!.id;
  approvalSessions.delete(chatId);

  let approved = 0;
  let rejected = 0;

  for (const [actionId, decision] of s.decisions) {
    const isApproved = decision === "approved";
    s.tracker.updateStatus(actionId, decision, isApproved);
    if (isApproved) approved++;
    else rejected++;
  }

  // Also reject anything not explicitly decided (safety net)
  for (const a of s.pending) {
    if (!s.decisions.has(a.id)) {
      s.tracker.updateStatus(a.id, "rejected", false);
      rejected++;
    }
  }

  if (approved === 0) {
    s.executor.clearStaging();
    await ctx.editMessageText(
      `❌ All ${rejected} change(s) rejected. Nothing was applied.`
    );
    return;
  }

  const { errors } = s.executor.applyApprovedFromTracker();
  s.executor.clearStaging();

  if (errors.length > 0) {
    await ctx.editMessageText(
      `⚠️ *Applied ${approved} change(s) with ${errors.length} error(s):*\n\n${errors.map((e: string) => `• ${e}`).join("\n")}\n\n❌ ${rejected} change(s) rejected.`,
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.editMessageText(
      `✅ *Review complete.*\n\n✅ ${approved} change(s) applied\n❌ ${rejected} change(s) rejected`
    );
  }
}

/**
 * Splits long text into chunks under maxLen to avoid Telegram 4096 char limit.
 */
function chunkText(text: string, maxLen = 3500): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > maxLen) {
      chunks.push(current);
      current = "";
    }
    current += line + "\n";
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/**
 * Inline diff coloring for per-file diffs sent via reply.
 */
function colorDiffForTelegramInline(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (line.startsWith("+++") || line.startsWith("---"))
        return `<b>${escaped}</b>`;
      if (line.startsWith("+")) return `<code>🟢 ${escaped}</code>`;
      if (line.startsWith("-")) return `<code>🔴 ${escaped}</code>`;
      if (line.startsWith("@@")) return `<i>${escaped}</i>`;
      return `<code>${escaped}</code>`;
    })
    .join("\n");
}

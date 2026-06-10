// modes/agent/approval.ts — CLI version, also improved
import { select, isCancel } from "@clack/prompts";
import chalk from "chalk";
import type { ActionTracker } from "./action-tracker.ts";
import type { ActionLog } from "./types.ts";
import { composeBeforeAfter, formatPatch } from "./diff-view.ts";

interface ReviewGroup {
  label: string;
  actionIds: string[];
  patch: string | null;
}

function colorDiffForCli(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---"))
        return chalk.bold(line);
      if (line.startsWith("+")) return chalk.green(line);
      if (line.startsWith("-")) return chalk.red(line);
      if (line.startsWith("@@")) return chalk.cyan(line);
      return chalk.dim(line);
    })
    .join("\n");
}

function groupPending(pending: ActionLog[]): ReviewGroup[] {
  const byPath = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];

  for (const a of pending) {
    if (a.type === "tool_execute") {
      shells.push(a);
      continue;
    }
    if (!byPath.has(a.path)) byPath.set(a.path, []);
    byPath.get(a.path)!.push(a);
  }

  const groups: ReviewGroup[] = [];

  for (const [p, acts] of [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = acts.sort(
      (x, y) => x.timestamp.getTime() - y.timestamp.getTime()
    );

    if (sorted.every((x) => x.type === "folder_create")) {
      groups.push({
        label: `Create folder: ${p}`,
        actionIds: sorted.map((x) => x.id),
        patch: null,
      });
      continue;
    }

    const { before, after } = composeBeforeAfter(sorted);
    const patch = formatPatch(p, before, after);
    const kinds = [...new Set(sorted.map((x) => x.type))].join(", ");
    groups.push({
      label: `${p} (${kinds})`,
      actionIds: sorted.map((x) => x.id),
      patch,
    });
  }

  for (const s of shells) {
    groups.push({
      label: `Shell: ${s.details.command ?? "(no command)"}`,
      actionIds: [s.id],
      patch: null,
    });
  }

  return groups;
}

export async function runApprovalFlow(
  tracker: ActionTracker
): Promise<boolean> {
  const pending = tracker.pendingMutations();

  if (pending.length === 0) {
    console.log(chalk.dim("\nNo staged changes to review.\n"));
    return false;
  }

  console.log(
    chalk.cyan(`\n📋 ${pending.length} staged change(s) ready for review.\n`)
  );

  const choice = await select({
    message: "How would you like to review?",
    options: [
      { value: "all",    label: "✅ Approve and apply all" },
      { value: "select", label: "🔍 Review file by file" },
      { value: "cancel", label: "🚫 Cancel — discard everything" },
    ],
  });

  if (isCancel(choice) || choice === "cancel") {
    for (const a of pending) tracker.updateStatus(a.id, "rejected", false);
    console.log(chalk.dim("\nAll changes discarded.\n"));
    return false;
  }

  if (choice === "all") {
    for (const a of pending) tracker.updateStatus(a.id, "approved", true);
    return true;
  }

  // File-by-file review
  const groups = groupPending(pending);
  let approvedCount = 0;
  let rejectedCount = 0;

  for (const [i, g] of groups.entries()) {
    console.log(
      chalk.cyan(`\n[${i + 1}/${groups.length}]`),
      chalk.bold(g.label)
    );

    while (true) {
      const opt = await select({
        message: "What would you like to do?",
        options: [
          { value: "accept", label: "✅ Accept" },
          {
            value: "diff",
            label: "📋 Show diff",
            hint: g.patch ? "" : "N/A — no diff for this type",
          },
          { value: "reject", label: "❌ Reject" },
          { value: "cancel", label: "🚫 Cancel — discard remaining" },
        ],
      });

      if (isCancel(opt) || opt === "cancel") {
        // Reject all remaining (current + future groups)
        for (const id of g.actionIds) {
          tracker.updateStatus(id, "rejected", false);
          rejectedCount++;
        }
        for (const remaining of groups.slice(i + 1)) {
          for (const id of remaining.actionIds) {
            tracker.updateStatus(id, "rejected", false);
            rejectedCount++;
          }
        }
        console.log(chalk.dim(`\nCancelled. ${rejectedCount} change(s) discarded.\n`));
        return approvedCount > 0;
      }

      if (opt === "diff") {
        if (g.patch) {
          console.log("\n" + colorDiffForCli(g.patch) + "\n");
        } else {
          console.log(chalk.dim("\n  No diff available for this change type.\n"));
        }
        continue; // re-show the select
      }

      const approved = opt === "accept";
      for (const id of g.actionIds) {
        tracker.updateStatus(id, approved ? "approved" : "rejected", approved);
      }

      if (approved) approvedCount++;
      else rejectedCount++;

      console.log(
        approved
          ? chalk.green(`  ✓ Accepted`)
          : chalk.red(`  ✗ Rejected`)
      );
      break;
    }
  }

  console.log(
    chalk.cyan(
      `\nReview complete: ✅ ${approvedCount} accepted · ❌ ${rejectedCount} rejected\n`
    )
  );

  return approvedCount > 0;
}

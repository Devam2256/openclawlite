// modes/telegram/approval-session.ts
import { Markup } from 'telegraf';
import type { ActionTracker } from '../agent/action-tracker.ts';
import type { ToolExecutor } from '../agent/tool-executor.ts';
import type { ActionLog } from '../agent/types.ts';
import { composeBeforeAfter, formatPatch } from '../agent/diff-view.ts';
import { clip } from './text.ts';

export interface ApprovalSession {
  tracker: ActionTracker;
  executor: ToolExecutor;
  pending: ActionLog[];
  // Per-file review state
  reviewIndex: number;         // which group we're currently reviewing
  groups: ReviewGroup[];
  perFileMode: boolean;        // whether we're in file-by-file mode
  decisions: Map<string, 'approved' | 'rejected'>; // actionId → decision
}

export interface ReviewGroup {
  label: string;
  actionIds: string[];
  patch: string | null;
}

export const approvalSessions = new Map<number, ApprovalSession>();

// ─── Grouping ────────────────────────────────────────────────────────────────

function groupPending(pending: ActionLog[]): ReviewGroup[] {
  const files = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];

  for (const a of pending) {
    if (a.type === 'tool_execute') {
      shells.push(a);
    } else {
      if (!files.has(a.path)) files.set(a.path, []);
      files.get(a.path)!.push(a);
    }
  }

  const groups: ReviewGroup[] = [];

  for (const [filePath, actions] of files) {
    const sorted = [...actions].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    const { before, after } = composeBeforeAfter(sorted);
    const patch = formatPatch(filePath, before, after);
    const kinds = [...new Set(sorted.map((x) => x.type))].join(', ');
    groups.push({
      label: `📄 ${filePath} (${kinds})`,
      actionIds: sorted.map((x) => x.id),
      patch,
    });
  }

  for (const s of shells) {
    groups.push({
      label: `🖥 Shell: ${s.details.command ?? '(no command)'}`,
      actionIds: [s.id],
      patch: null,
    });
  }

  return groups;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function approvalSummary(pending: ActionLog[]): string {
  const files = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];

  for (const a of pending) {
    if (a.type === 'tool_execute') shells.push(a);
    else {
      if (!files.has(a.path)) files.set(a.path, []);
      files.get(a.path)!.push(a);
    }
  }

  const fileLines = [...files].map(([path, actions]) => {
    const types = [...new Set(actions.map((a) => a.type.replace(/_/g, ' ')))].join(', ');
    return `📄 *${path}* (${types})`;
  });

  const shellLines = shells.map(
    (s) => `🖥 *Shell:* \`${s.details.command}\``
  );

  return [
    '🔔 *Staged Changes — Review Before Applying*',
    '',
    ...fileLines,
    ...shellLines,
    '',
    `*Total:* ${pending.length} change(s)`,
    '',
    '_Choose how to review:_',
  ].join('\n');
}

function colorDiffForTelegram(patch: string): string {
  const lines = patch.split('\n');
  const colored = lines.map((line) => {
    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (line.startsWith('+++') || line.startsWith('---')) return `<b>${escaped}</b>`;
    if (line.startsWith('+')) return `<code>🟢 ${escaped}</code>`;
    if (line.startsWith('-')) return `<code>🔴 ${escaped}</code>`;
    if (line.startsWith('@@')) return `<i>${escaped}</i>`;
    return `<code>${escaped}</code>`;
  });

  return colored.join('\n');
}

export function approvalDiff(pending: ActionLog[]): string {
  const files = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];

  for (const a of pending) {
    if (a.type === 'tool_execute') shells.push(a);
    else {
      if (!files.has(a.path)) files.set(a.path, []);
      files.get(a.path)!.push(a);
    }
  }

  const parts: string[] = [];

  for (const [filePath, actions] of files) {
    const sorted = [...actions].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    const { before, after } = composeBeforeAfter(sorted);
    const patch = formatPatch(filePath, before, after);
    parts.push(`<b>${filePath}</b>\n${colorDiffForTelegram(clip(patch, 1500))}`);
  }

  for (const s of shells) {
    parts.push(`🖥 <b>Shell:</b> <code>${s.details.command}</code>`);
  }

  return parts.join('\n\n─────────────────\n\n').trim();
}

// ─── Per-file review message ─────────────────────────────────────────────────

export function perFileMessage(session: ApprovalSession): string {
  const { groups, reviewIndex, decisions } = session;
  const group = groups[reviewIndex]!;
  const done = reviewIndex;
  const total = groups.length;

  const approved = [...decisions.values()].filter((v) => v === 'approved').length;
  const rejected = [...decisions.values()].filter((v) => v === 'rejected').length;

  return [
    `📋 *Reviewing change ${done + 1} of ${total}*`,
    '',
    `*${group.label}*`,
    '',
    `Progress: ✅ ${approved} approved · ❌ ${rejected} rejected · ⏳ ${total - done} remaining`,
  ].join('\n');
}

export function perFileKeyboard(session: ApprovalSession) {
  const { groups, reviewIndex } = session;
  const group = groups[reviewIndex]!;
  const hasDiff = !!group.patch;

  return Markup.inlineKeyboard([
    hasDiff
      ? [Markup.button.callback('📋 Show Diff', 'approval_file_diff')]
      : [],
    [
      Markup.button.callback('✅ Accept', 'approval_file_accept'),
      Markup.button.callback('❌ Reject', 'approval_file_reject'),
    ],
    [Markup.button.callback('🚫 Cancel Everything', 'approval_cancel')],
  ].filter((row) => row.length > 0));
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function finishOrApprove(
  ctx: { reply: (t: string, o?: object) => Promise<unknown> },
  chatId: number,
  tracker: ActionTracker,
  executor: ToolExecutor,
  noChangesMsg: string,
) {
  const pending = tracker.pendingMutations();

  if (pending.length === 0) {
    await ctx.reply(noChangesMsg);
    return;
  }

  const groups = groupPending(pending);

  const session: ApprovalSession = {
    tracker,
    executor,
    pending,
    reviewIndex: 0,
    groups,
    perFileMode: false,
    decisions: new Map(),
  };

  approvalSessions.set(chatId, session);

  await ctx.reply(approvalSummary(pending), {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📋 Show All Diffs', 'approval_diff')],
      [Markup.button.callback('🔍 Review File by File', 'approval_per_file')],
      [
        Markup.button.callback('✅ Accept All', 'approval_accept'),
        Markup.button.callback('❌ Reject All', 'approval_reject'),
      ],
    ]),
  });
}

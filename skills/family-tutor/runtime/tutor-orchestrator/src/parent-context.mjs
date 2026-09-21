export function isAuthorizedParent(message, config) {
  return Boolean(config.discord?.parentChannelId && message.channelId === config.discord.parentChannelId);
}

export function parseParentCommand(text) {
  const [command, childId, ...rest] = text.trim().split(/\s+/);
  if (!command?.startsWith('!')) return null;
  if (command === '!help' || command === '!threads') return { command };
  if (!['!goal', '!focus', '!guide', '!ask', '!status'].includes(command)) return { command };
  return { command, childId, value: rest.join(' ').trim() };
}

const discordChannelMention = /<#(\d+)>/g;

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function renderParentNaturalText(input, channelMentionId, childName) {
  return normalizeWhitespace(String(input || '').replaceAll(`<#${channelMentionId}>`, childName));
}

function parentQueryType(value) {
  return /(?:\?|\bhow(?:'s| is| are| was| were)?\b|\bstatus\b|\bprogress\b|\bdoing\b|\bgoing\b|\blearning\b|\bunderstand(?:ing)?\b|\bstruggl(?:e|es|ing)\b|\bimprov(?:e|ing|ement)\b|\brecent\b)/i.test(value)
    ? 'status-question'
    : 'guidance-assignment';
}

export function parseParentMessage(text, children) {
  const input = String(text || '').trim();
  const mentions = [...input.matchAll(discordChannelMention)];
  const withoutMention = input.replace(discordChannelMention, ' ').replace(/\s+/g, ' ').trim();
  const command = parseParentCommand(withoutMention);
  if (command?.command === '!help' || command?.command === '!threads') return command;
  if (mentions.length !== 1) {
    if (!command) return null;
    const { childId: _ignoredChildId, ...unroutedCommand } = command;
    return unroutedCommand;
  }
  const channelMentionId = mentions[0][1];
  if (command) {
    const [commandName, ...commandValue] = withoutMention.split(/\s+/);
    return { command: commandName, channelMentionId, value: commandValue.join(' ').trim() };
  }
  if (!withoutMention) return null;
  return { command: 'parent-query', channelMentionId, value: input };
}

export function buildParentContextPrompt({ child, command, value, authorId, messageId, memory='' }) {
  const type = command === '!ask' || command === '!status'
    ? 'status-question'
    : command === 'parent-query' ? parentQueryType(value) : 'guidance-assignment';
  const instruction = command === '!goal'
    ? `Record this as a durable tutoring goal for ${child.name}.`
    : command === '!focus'
      ? `Use this as the current tutoring focus for ${child.name}.`
      : command === '!guide'
        ? `Apply this durable parent guidance for ${child.name}.`
        : 'Answer the parent using only the current learner context and durable AGENTS.md memory.';
  return [
    '[FAMILY TUTOR PARENT CONTEXT]',
    `source=discord-parent type=${type} author=${authorId} message=${messageId}`,
    `target-child=${child.id}`,
    'This context came from an authorized parent. It was not written by the child.',
    "Handle it in this child's existing persistent tutor thread; do not create a second parent thread or memory store.",
    instruction,
    `Parent message: ${value}`,
    type === 'status-question'
      ? 'Return a concise privacy-filtered learning summary: progress/evidence, current difficulty or misconception, next step, and useful parent action. Do not include casual conversation, routine transcript excerpts, or unnecessary private details.'
      : 'Reply briefly to the parent after applying the guidance. Keep durable changes in the complete AGENTS.md replacement marker only.',
    'If the child context contains a serious safety/wellbeing concern or meaningful academic risk requiring support, escalate the minimum necessary signal and suggested parent action using FAMILY_TUTOR_PARENT.',
    '', '<DURABLE_LEARNER_CONTEXT>', memory || '(No learner context has been recorded yet.)', '</DURABLE_LEARNER_CONTEXT>'
  ].join('\n');
}

export const statusCommand = { name: 'status', description: 'Show a privacy-filtered learning status for one child or all children' };

export function findChildByChannelName(children, channelName) {
  const wanted = String(channelName || '').trim();
  return children.find((child) => child.id === wanted) || null;
}

export function childProjectName(channelName) {
  return `neo/family-tutor/${String(channelName || '').trim()}`;
}

export function validateChildChannel(child, channel) {
  const channelName = String(channel?.name || '').trim();
  if (!channelName) throw new Error('Family Tutor configuration error: Discord child channel has no name.');
  if (channelName !== child.id) {
    throw new Error(`Family Tutor configuration error: Discord channel #${channelName} must match child id/project suffix ${child.id}.`);
  }
  const project = childProjectName(channelName);
  if (child.project && child.project !== project) {
    throw new Error(`Family Tutor configuration error: #${channelName} must use ChatGPT Project ${project}; found ${child.project}.`);
  }
  return { childId: channelName, project };
}

export function buildSlashStatusPrompt({ child, memory }) {
  return [
    `[PARENT STATUS REQUEST] Give a concise, privacy-filtered learning status for ${child.name}.`,
    'Use only this existing child Project/thread and the durable learner context below.',
    'Return at most 4 short bullets covering recent topic, demonstrated understanding or progress, an active misconception or gap, and the next useful step or parent support.',
    'Do not quote or summarize private conversation, casual remarks, sensitive details, or the raw transcript. Say "No recent learning signal" when the context does not support a claim.',
    'This is read-only: do not emit control markers, update AGENTS.md, or create any durable learner-state file.',
    '', '<DURABLE_LEARNER_CONTEXT>', memory || '(No learner context has been recorded yet.)', '</DURABLE_LEARNER_CONTEXT>',
  ].join('\n');
}

export function formatSlashStatus(child, text) {
  const clean = String(text || '').replace(/<FAMILY_TUTOR_PARENT>[\s\S]*?<\/FAMILY_TUTOR_PARENT>/gi, '').replace(/<FAMILY_TUTOR_MEMORY>[\s\S]*?<\/FAMILY_TUTOR_MEMORY>/gi, '').replace(/<FAMILY_TUTOR_ROLLOVER\s*\/\s*>/gi, '').trim();
  if (!clean) return `**${child.name}** — No recent learning signal.`;
  return [`**${child.name}**`, ...clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4)].join('\n');
}

export function formatSlashOverview(statuses) { return statuses.join('\n\n') || 'No configured children.'; }
export function canUseStatus({ channelId }, config) {
  return channelId === config.discord.parentChannelId;
}
export function statusDenialMessage() { return 'This command is available only in the configured parent control channel.'; }

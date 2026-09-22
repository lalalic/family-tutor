import { buildParentContext as buildParentRuntimeContext } from './runtime-context.mjs';

export function isAuthorizedParent(message, config) {
  return Boolean(config.discord?.parentChannelId && message.channelId === config.discord.parentChannelId);
}

export function parseParentCommand(text) {
  const [command, childId, ...rest] = text.trim().split(/\s+/);
  if (!command?.startsWith('!')) return null;
  if (command === '!help' || command === '!threads') return { command };
  if (!['!goal', '!focus', '!guide', '!ask', '!status', '!remind'].includes(command)) return { command };
  return { command, childId, value: rest.join(' ').trim() };
}

const discordChannelMention = /<#(\d+)>/g;

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function renderParentNaturalText(input, channelMentionId, childName, childChannelId) {
  const logicalMention = `@${childName}(channelId=${childChannelId})`;
  return normalizeWhitespace(String(input || '').replaceAll(`<#${channelMentionId}>`, logicalMention));
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

export function buildParentContextPrompt({ text }) {
  return buildParentRuntimeContext({ text });
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
  return buildParentRuntimeContext({ text: `status @${child.id}` });
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

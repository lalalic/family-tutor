import { buildKidContext } from './runtime-context.mjs';

export async function handleBrowserChildMessage(message, child, browserBridge) {
  const incoming = message.content.trim();
  const attachments = [...message.attachments.values()].slice(0, 4).map((attachment) => ({
    url: attachment.url,
    name: attachment.name || `attachment-${attachment.id}`,
    mimeType: attachment.contentType || '',
    size: Number(attachment.size || 0),
  }));
  if (!incoming && !attachments.length) return;

  await browserBridge.enqueue({
    childId: child.id,
    text: buildKidContext({ childId: child.id, text: incoming }),
    attachments,
    origin: {
      channelId: message.channelId,
      messageId: message.id,
      threadId: message.channel?.isThread?.() ? message.channelId : null,
    },
  });
}

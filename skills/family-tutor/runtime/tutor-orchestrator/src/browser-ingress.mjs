import { buildKidContext } from './runtime-context.mjs';
import { isAudioAttachment, transcribeAudioAttachments } from './asr.mjs';

export async function handleBrowserChildMessage(message, child, browserBridge, { transcribe = transcribeAudioAttachments } = {}) {
  const incoming = message.content.trim();
  const attachments = [...message.attachments.values()].slice(0, 4).map((attachment) => ({
    url: attachment.url,
    name: attachment.name || `attachment-${attachment.id}`,
    mimeType: attachment.contentType || '',
    size: Number(attachment.size || 0),
  }));
  if (!incoming && !attachments.length) return;
  const audioAttachments = attachments.filter(isAudioAttachment);
  const passthroughAttachments = attachments.filter((attachment) => !isAudioAttachment(attachment));
  const voiceTranscript = audioAttachments.length ? await transcribe(audioAttachments) : null;
  const contextMessage = [incoming, voiceTranscript].filter(Boolean).join('\n\n');

  await browserBridge.enqueue({
    childId: child.id,
    text: buildKidContext({ childName: child.name, text: contextMessage }),
    attachments: passthroughAttachments,
    origin: {
      channelId: message.channelId,
      messageId: message.id,
      threadId: message.channel?.isThread?.() ? message.channelId : null,
    },
  });
}

function assertType(type) {
  if (type !== 'kid' && type !== 'parent') throw new Error(`unsupported runtime context type: ${type}`);
}

export function runtimeContext(type, data) {
  assertType(type);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('runtime context data must be an object');
  return `<FAMILY_TUTOR_CONTEXT>\n${JSON.stringify({ type, data })}\n</FAMILY_TUTOR_CONTEXT>`;
}

export function attachmentMetadata(attachments = []) {
  return attachments.map((attachment) => ({
    name: String(attachment?.name || 'attachment'),
    mimeType: String(attachment?.mimeType || attachment?.contentType || ''),
    size: Number(attachment?.size || 0),
  }));
}

function messageContext(type,{ senderChannelId, senderName, message, attachments = [] }) {
  return runtimeContext(type, {
    sender: { channelId: String(senderChannelId || ''), name: String(senderName || '') },
    message: String(message || ''),
    attachments: attachmentMetadata(attachments),
  });
}

export function buildKidContext({ childId, childName, text, attachments = [] }) {
  return messageContext('kid', { senderChannelId: childId, senderName: childName || childId, message: text, attachments });
}

export function buildParentContext({ text, attachments = [] }) {
  return messageContext('parent', { senderChannelId: 'parents', senderName: 'Parents', message: text, attachments });
}

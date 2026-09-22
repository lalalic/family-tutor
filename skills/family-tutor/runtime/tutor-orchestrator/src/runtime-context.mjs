function assertType(type) {
  if (type !== 'kid' && type !== 'parent') throw new Error(`unsupported runtime context type: ${type}`);
}

export function runtimeContext(type, data) {
  assertType(type);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('runtime context data must be an object');
  return `<FAMILY_TUTOR_CONTEXT>\n${JSON.stringify({ type, data })}\n</FAMILY_TUTOR_CONTEXT>`;
}

function messageContext(type,{ senderName, message }) {
  return runtimeContext(type, {
    senderName: String(senderName || ''),
    message: String(message || ''),
  });
}

export function buildKidContext({ childName, text }) {
  return messageContext('kid', { senderName: childName || 'Kid', message: text });
}

export function buildParentContext({ text }) {
  return messageContext('parent', { senderName: 'Parents', message: text });
}

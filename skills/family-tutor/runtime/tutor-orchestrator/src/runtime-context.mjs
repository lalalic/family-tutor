function assertType(type) {
  if (type !== 'kid' && type !== 'parent') throw new Error(`unsupported runtime context type: ${type}`);
}

export function runtimeContext(type, data) {
  assertType(type);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('runtime context data must be an object');
  return `<FAMILY_TUTOR_CONTEXT>\n${JSON.stringify({ type, data })}\n</FAMILY_TUTOR_CONTEXT>`;
}

function messageContext(type,{ senderName, message, correlationId }) {
  const data={
    senderName: String(senderName || ''),
    message: String(message || ''),
  };
  if(correlationId) data.correlationId=String(correlationId);
  return runtimeContext(type,data);
}

export function buildKidContext({ childName, text, correlationId }) {
  return messageContext('kid', { senderName: childName || 'Kid', message: text, correlationId });
}

export function buildParentContext({ text, correlationId }) {
  return messageContext('parent', { senderName: 'Parents', message: text, correlationId });
}

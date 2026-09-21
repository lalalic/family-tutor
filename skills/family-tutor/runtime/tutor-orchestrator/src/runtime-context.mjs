function assertType(type) {
  if (type !== 'kid' && type !== 'parent') throw new Error(`unsupported runtime context type: ${type}`);
}

export function runtimeContext(type, data) {
  assertType(type);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('runtime context data must be an object');
  return `<FAMILY_TUTOR_CONTEXT>\n${JSON.stringify({ type, data })}\n</FAMILY_TUTOR_CONTEXT>`;
}

export function buildKidContext({ childId, text }) {
  return runtimeContext('kid', { childId, studentMessage: String(text || '') });
}

export function buildParentContext({ childId, requestType, message }) {
  return runtimeContext('parent', {
    targetChild: childId,
    request: requestType,
    message: String(message || ''),
  });
}

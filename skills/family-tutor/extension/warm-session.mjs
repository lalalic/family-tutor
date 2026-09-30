export function isWarmTabTransportError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('stale family tutor content script')
    || text.includes('receiving end does not exist')
    || text.includes('could not establish connection')
    || text.includes('message port closed')
    || text.includes('the tab was closed')
    || text.includes('no tab with id');
}

export async function deliverWarmTurn({ tab, turn, sendTurn, reloadTab, waitReady }) {
  try {
    await sendTurn(tab, turn);
    return { delivered: true, tab, error: null, recoverable: true };
  } catch (firstError) {
    if (!isWarmTabTransportError(firstError)) {
      return { delivered: false, tab, error: firstError, recoverable: false };
    }
    await reloadTab(tab.id).catch(() => {});
    const ready = await waitReady(tab.id).catch(() => null);
    if (!ready) return { delivered: false, tab, error: firstError, recoverable: true };
    try {
      await sendTurn(ready, turn);
      return { delivered: true, tab: ready, error: null, recoverable: true };
    } catch (error) {
      return { delivered: false, tab: ready, error, recoverable: isWarmTabTransportError(error) };
    }
  }
}

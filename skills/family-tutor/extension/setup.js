(() => {
  const match = location.pathname.match(/^\/setup\/([^/]+)$/);
  if (!match) return;
  const status = document.getElementById('status');
  const claim = decodeURIComponent(match[1]);
  chrome.runtime.sendMessage({ type: 'family.setup.claim', claim }, (result) => {
    const error = chrome.runtime.lastError?.message || result?.error;
    if (status) status.textContent = error
      ? 'Family Tutor could not connect this browser. Please reopen the setup link and try again.'
      : `Connected. ${result?.children?.length || 0} learner${result?.children?.length === 1 ? '' : 's'} ready to link.`;
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  const btnFull = document.getElementById('btn-full');
  const btnArea = document.getElementById('btn-area');
  const btnSettings = document.getElementById('btn-settings');
  const status = document.getElementById('status');
  const result = document.getElementById('result');

  console.log('[Popup] loaded');

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('[Popup] active tabs:', tabs);
    return tabs[0];
  }

  async function ensureContentScriptInjected(tab) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      console.log('[Popup] content script already injected');
    } catch (err) {
      console.log('[Popup] injecting content script');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    }
  }

  btnFull.addEventListener('click', async () => {
    console.log('[Popup] btnFull clicked');
    status.textContent = '正在识别整页…';
    result.classList.remove('visible');

    const tab = await getActiveTab();
    await ensureContentScriptInjected(tab);

    try {
      console.log('[Popup] sending startFullOcr');
      const response = await chrome.runtime.sendMessage({ action: 'startFullOcr' });
      console.log('[Popup] startFullOcr response:', response);
      if (!response) throw new Error('无响应，请检查 Service Worker 控制台');
      if (response.error) throw new Error(response.error);
      status.textContent = '识别完成';
      result.textContent = response.text || '';
      result.classList.add('visible');
    } catch (err) {
      console.error('[Popup] error:', err);
      status.textContent = `失败：${err.message}`;
    }
  });

  btnArea.addEventListener('click', async () => {
    console.log('[Popup] btnArea clicked');
    const tab = await getActiveTab();
    await ensureContentScriptInjected(tab);
    try {
      console.log('[Popup] sending startAreaSelection to tab', tab.id);
      await chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
      console.log('[Popup] startAreaSelection message sent');
    } catch (err) {
      console.error('[Popup] startAreaSelection error:', err);
      status.textContent = `失败：${err.message}`;
    }
    window.close();
  });

  btnSettings.addEventListener('click', () => {
    console.log('[Popup] btnSettings clicked');
    chrome.runtime.openOptionsPage();
  });
});

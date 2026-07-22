document.addEventListener('DOMContentLoaded', async () => {
  const langInput = document.getElementById('lang');
  const delayInput = document.getElementById('delay');
  const historyLimitInput = document.getElementById('historyLimit');
  const saveBtn = document.getElementById('save');
  const clearHistoryBtn = document.getElementById('clearHistory');
  const exportHistoryBtn = document.getElementById('exportHistory');
  const historyCountEl = document.getElementById('historyCount');
  const storageSizeEl = document.getElementById('storageSize');
  const tip = document.getElementById('tip');

  // 从 chrome.storage.local 读取 config 对象
  const stored = await chrome.storage.local.get(['config']);
  const config = stored.config || {};

  if (config.lang) langInput.value = config.lang;
  if (config.delay != null) delayInput.value = config.delay;
  if (config.historyLimit != null) historyLimitInput.value = config.historyLimit;

  async function updateHistoryInfo() {
    const res = await chrome.runtime.sendMessage({ action: 'getHistoryInfo' });
    historyCountEl.textContent = res.count;
    storageSizeEl.textContent = res.size ? `（约 ${res.size}）` : '';
  }

  updateHistoryInfo();

  saveBtn.addEventListener('click', async () => {
    const currentConfig = stored.config || {};
    const updatedConfig = {
      ...currentConfig,
      lang: langInput.value.trim(),
      delay: parseInt(delayInput.value, 10) || 300,
      historyLimit: parseInt(historyLimitInput.value, 10) || 50
    };
    await chrome.storage.local.set({ config: updatedConfig });
    tip.textContent = '已保存';
    setTimeout(() => tip.textContent = '', 2000);
  });

  clearHistoryBtn.addEventListener('click', async () => {
    if (!confirm('确定要清空所有历史记录吗？此操作不可恢复。')) return;
    await chrome.runtime.sendMessage({ action: 'clearHistory' });
    tip.textContent = '历史记录已清空';
    updateHistoryInfo();
    setTimeout(() => tip.textContent = '', 2000);
  });

  exportHistoryBtn.addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ action: 'getHistory' });
    const history = res.history || [];
    if (!history.length) {
      tip.textContent = '没有历史记录可导出';
      setTimeout(() => tip.textContent = '', 2000);
      return;
    }
    const text = history.map(item => {
      return `[${item.date}] ${item.type === 'full' ? '整页识别' : '框选识别'} (${item.id})\n${item.text}\n${'='.repeat(50)}`;
    }).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr-history-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    tip.textContent = '历史记录已导出';
    setTimeout(() => tip.textContent = '', 2000);
  });
});


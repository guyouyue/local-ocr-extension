document.addEventListener('DOMContentLoaded', async () => {
  const ocrEngineSelect = document.getElementById('ocrEngine');
  const langInput = document.getElementById('lang');
  const delayInput = document.getElementById('delay');
  const historyLimitInput = document.getElementById('historyLimit');
  const continuousPageCheckbox = document.getElementById('continuousPageMode');
  const maxContinuousPagesInput = document.getElementById('maxContinuousPages');
  const pageFlipDelayInput = document.getElementById('pageFlipDelay');
  const saveDebugScreenshotsCheckbox = document.getElementById('saveDebugScreenshots');
  const continuousChapterCheckbox = document.getElementById('continuousChapterMode');
  const maxContinuousChaptersInput = document.getElementById('maxContinuousChapters');
  const chapterFlipDelayInput = document.getElementById('chapterFlipDelay');
  const paddleocrSettings = document.getElementById('paddleocrSettings');
  const paddleOcrApiTokenInput = document.getElementById('paddleOcrApiToken');
  const paddleOcrApiModelSelect = document.getElementById('paddleOcrApiModel');
  const saveBtn = document.getElementById('save');
  const clearHistoryBtn = document.getElementById('clearHistory');
  const exportHistoryBtn = document.getElementById('exportHistory');
  const historyCountEl = document.getElementById('historyCount');
  const storageSizeEl = document.getElementById('storageSize');
  const tip = document.getElementById('tip');

  // 从 chrome.storage.local 读取 config 对象
  const stored = await chrome.storage.local.get(['config']);
  const config = stored.config || {};

  if (config.ocrEngine) ocrEngineSelect.value = config.ocrEngine;
  if (config.lang) langInput.value = config.lang;
  if (config.delay != null) delayInput.value = config.delay;
  if (config.historyLimit != null) historyLimitInput.value = config.historyLimit;
  if (config.paddleOcrApiToken) paddleOcrApiTokenInput.value = config.paddleOcrApiToken;
  if (config.paddleOcrApiModel) paddleOcrApiModelSelect.value = config.paddleOcrApiModel;
  continuousPageCheckbox.checked = !!config.continuousPageMode;
  if (config.maxContinuousPages != null) maxContinuousPagesInput.value = config.maxContinuousPages;
  if (config.pageFlipDelay != null) pageFlipDelayInput.value = config.pageFlipDelay;
  saveDebugScreenshotsCheckbox.checked = !!config.saveDebugScreenshots;
  continuousChapterCheckbox.checked = !!config.continuousChapterMode;
  if (config.maxContinuousChapters != null) maxContinuousChaptersInput.value = config.maxContinuousChapters;
  if (config.chapterFlipDelay != null) chapterFlipDelayInput.value = config.chapterFlipDelay;

  // 根据选择的引擎显示/隐藏对应的配置
  function updateEngineSettings() {
    const engine = ocrEngineSelect.value;
    const tesseractSettings = document.getElementById('tesseractSettings');
    const paddleocrSettings = document.getElementById('paddleocrSettings');

    if (engine === 'tesseract') {
      tesseractSettings.style.display = 'block';
      paddleocrSettings.style.display = 'none';
    } else if (engine === 'paddleocr') {
      tesseractSettings.style.display = 'none';
      paddleocrSettings.style.display = 'block';
    }
  }

  updateEngineSettings();
  ocrEngineSelect.addEventListener('change', updateEngineSettings);

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
      ocrEngine: ocrEngineSelect.value,
      lang: langInput.value.trim(),
      delay: parseInt(delayInput.value, 10) || 300,
      historyLimit: parseInt(historyLimitInput.value, 10) || 50,
      paddleOcrApiToken: paddleOcrApiTokenInput.value.trim(),
      paddleOcrApiModel: paddleOcrApiModelSelect.value,
      continuousPageMode: continuousPageCheckbox.checked,
      maxContinuousPages: parseInt(maxContinuousPagesInput.value, 10) || 20,
      pageFlipDelay: parseInt(pageFlipDelayInput.value, 10) || 2000,
      saveDebugScreenshots: saveDebugScreenshotsCheckbox.checked,
      continuousChapterMode: continuousChapterCheckbox.checked,
      maxContinuousChapters: parseInt(maxContinuousChaptersInput.value, 10) || 10,
      chapterFlipDelay: parseInt(chapterFlipDelayInput.value, 10) || 3000
    };

    // 验证：如果选择了 PaddleOCR，必须填写 token
    if (updatedConfig.ocrEngine === 'paddleocr' && !updatedConfig.paddleOcrApiToken) {
      tip.textContent = '请填写 PaddleOCR API Token';
      tip.style.color = 'red';
      setTimeout(() => {
        tip.textContent = '';
        tip.style.color = '';
      }, 3000);
      return;
    }

    await chrome.storage.local.set({ config: updatedConfig });
    tip.textContent = '已保存';
    tip.style.color = 'green';
    setTimeout(() => {
      tip.textContent = '';
      tip.style.color = '';
    }, 2000);
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


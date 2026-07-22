console.log('[Background] background.js start');

const state = { isCapturing: false };

const DEFAULT_CONFIG = {
  lang: 'chi_sim',
  delay: 300,
  historyLimit: 50
};

const CONFIG_KEY = 'config';
const HISTORY_KEY = 'history';

async function loadDefaultConfigFromFile() {
  try {
    const response = await fetch(chrome.runtime.getURL('config/default.json'));
    if (!response.ok) throw new Error('Failed to load default config');
    const fileConfig = await response.json();
    console.log('[Config] loaded default config from file:', fileConfig);

    const merged = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(fileConfig)) {
      if (fileConfig[key] !== undefined) {
        merged[key] = fileConfig[key];
      }
    }
    return merged;
  } catch (err) {
    console.error('[Config] load default config from file failed:', err);
    return { ...DEFAULT_CONFIG };
  }
}

async function initConfig() {
  console.log('[Config] initializing config');

  // 迁移旧版配置（旧版本直接存储在 storage root 中）
  const legacy = await chrome.storage.local.get(['lang', 'delay', 'historyLimit']);
  if (legacy.lang !== undefined || legacy.delay !== undefined || legacy.historyLimit !== undefined) {
    console.log('[Config] migrating legacy config:', legacy);
    const existing = await chrome.storage.local.get([CONFIG_KEY]);
    const currentConfig = existing[CONFIG_KEY] || {};
    const migrated = { ...currentConfig };
    if (legacy.lang !== undefined && migrated.lang === undefined) migrated.lang = legacy.lang;
    if (legacy.delay !== undefined && migrated.delay === undefined) migrated.delay = legacy.delay;
    if (legacy.historyLimit !== undefined && migrated.historyLimit === undefined) migrated.historyLimit = legacy.historyLimit;
    await chrome.storage.local.set({ [CONFIG_KEY]: migrated });
    await chrome.storage.local.remove(['lang', 'delay', 'historyLimit']);
  }

  const fileDefaults = await loadDefaultConfigFromFile();
  const stored = await chrome.storage.local.get([CONFIG_KEY]);
  const existing = stored[CONFIG_KEY] || {};

  const merged = { ...fileDefaults };
  for (const key of Object.keys(fileDefaults)) {
    if (existing[key] !== undefined) {
      merged[key] = existing[key];
    }
  }

  const hasNewKeys = Object.keys(fileDefaults).some(key => existing[key] === undefined);
  if (hasNewKeys) {
    console.log('[Config] merging new default fields:', merged);
    await chrome.storage.local.set({ [CONFIG_KEY]: merged });
  } else {
    console.log('[Config] config already exists:', merged);
  }

  return merged;
}

async function getConfig() {
  const fileDefaults = await loadDefaultConfigFromFile();
  const stored = await chrome.storage.local.get([CONFIG_KEY]);
  const config = stored[CONFIG_KEY] || fileDefaults;

  const merged = { ...fileDefaults };
  for (const key of Object.keys(fileDefaults)) {
    if (config[key] !== undefined) {
      merged[key] = config[key];
    }
  }

  return merged;
}

async function setConfig(updates) {
  const current = await getConfig();
  const merged = { ...current, ...updates };
  await chrome.storage.local.set({ [CONFIG_KEY]: merged });
  console.log('[Config] updated config:', merged);
  return merged;
}

async function getHistoryData() {
  const stored = await chrome.storage.local.get([HISTORY_KEY]);
  return stored[HISTORY_KEY] || [];
}

async function setHistoryData(history) {
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

let offscreenDocumentCreating = false;
let offscreenDocumentReady = false;

async function setupOffscreenDocument() {
  if (offscreenDocumentReady) return;
  if (offscreenDocumentCreating) {
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (offscreenDocumentReady) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
    return;
  }
  offscreenDocumentCreating = true;
  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      if (contexts && contexts.length > 0) {
        console.log('[Background] offscreen document already exists (getContexts)');
        offscreenDocumentReady = true;
        return;
      }
    }
    console.log('[Background] creating offscreen document');
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run Tesseract.js OCR worker in background'
    });
    offscreenDocumentReady = true;
    console.log('[Background] offscreen document created');
  } catch (err) {
    if (err.message && (err.message.includes('only be created') || err.message.includes('Only a single'))) {
      console.log('[Background] offscreen document already exists (create failed)');
      offscreenDocumentReady = true;
    } else {
      throw err;
    }
  } finally {
    offscreenDocumentCreating = false;
  }
}

function ensureContentScript() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) return reject(new Error('没有活动标签页'));
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          console.log('[Background] content script not ready, injecting into tab', tabId);
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          }, (execRes) => {
            if (chrome.runtime.lastError) {
              console.error('[Background] executeScript error:', chrome.runtime.lastError.message);
              return reject(new Error(chrome.runtime.lastError.message));
            }
            console.log('[Background] content script injected', execRes);
            setTimeout(resolve, 200);
          });
        } else {
          console.log('[Background] content script already active');
          resolve();
        }
      });
    });
  });
}

async function getSettings() {
  const config = await getConfig();
  console.log('[OCREngine] settings:', config);
  return config;
}

async function saveToHistory(text, type) {
  console.log('[Background] saving to history, type:', type, 'text length:', text?.length);
  const config = await getConfig();
  const historyList = await getHistoryData();

  const newRecord = {
    id: Date.now().toString(),
    text: text,
    type: type, // 'full' or 'area'
    timestamp: Date.now(),
    date: new Date().toLocaleString('zh-CN')
  };

  historyList.unshift(newRecord);

  // 限制历史记录数量
  if (historyList.length > config.historyLimit) {
    historyList.splice(config.historyLimit);
  }

  await setHistoryData(historyList);
  console.log('[Background] saved to history, total:', historyList.length);
}

function sendToActiveTab(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log('[OCREngine] active tabs count:', tabs?.length);
      if (!tabs.length) return reject(new Error('没有活动标签页'));
      const tabId = tabs[0].id;
      console.log('[OCREngine] sending message to tab', tabId, message.action);
      chrome.tabs.sendMessage(tabId, message, (result) => {
        if (chrome.runtime.lastError) {
          console.error('[OCREngine] sendMessage error:', chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        console.log('[OCREngine] sendMessage response for', message.action, ':', result);
        resolve(Array.isArray(result) ? result : [result]);
      });
    });
  });
}

function sleep(ms) {
  console.log('[OCREngine] sleep', ms, 'ms');
  return new Promise((r) => setTimeout(r, ms));
}

async function showResultInContentScript(text, error = null, type = '') {
  console.log('[OCREngine] showing result in content script, text length:', text?.length, 'error:', error);
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTabs.length) {
    console.error('[OCREngine] no active tab');
    return;
  }
  const tabId = activeTabs[0].id;
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'showOcrResult',
      text,
      error,
      type,
      title: type === 'full' ? '整页识别结果' : type === 'area' ? '框选识别结果' : 'OCR 识别结果'
    });
    console.log('[OCREngine] result panel shown in content script');
  } catch (err) {
    console.error('[OCREngine] showOcrResult failed:', err);
  }
}

async function recognize(images, lang) {
  console.log('[OCREngine] recognize start (offscreen), images:', images.length, 'lang:', lang);
  await setupOffscreenDocument();
  const res = await chrome.runtime.sendMessage({ action: 'recognizeImages', images, lang });
  console.log('[OCREngine] recognize response:', res);
  if (res?.error) throw new Error(res.error);
  return res?.text || '(未识别到文字)';
}

async function captureSequence(captureArea = null, onProgress) {
  console.log('[OCREngine] captureSequence start, captureArea:', captureArea);
  const settings = await getSettings();
  await ensureContentScript();
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTabs.length) throw new Error('没有活动标签页');
  const targetTab = activeTabs[0];
  console.log('[OCREngine] target tab:', targetTab.id, targetTab.url);

  if (targetTab.url && (targetTab.url.startsWith('devtools://') || targetTab.url.startsWith('chrome://') || targetTab.url.startsWith('edge://'))) {
    throw new Error('不能对浏览器内部页面（devtools/chrome/edge）进行截图');
  }

  const [metrics] = await sendToActiveTab({ action: 'getPageMetrics', captureArea });
  console.log('[OCREngine] raw metrics response:', metrics);

  const m = metrics?.viewportWidth ? metrics : metrics?.result;
  if (!m || !m.viewportWidth) {
    throw new Error('获取页面尺寸失败');
  }
  console.log('[OCREngine] extracted metrics:', m);

  const pieces = [];

  for (let y = 0; y < m.totalHeight; y += m.viewportHeight) {
    const offset = Math.min(y, Math.max(0, m.totalHeight - m.viewportHeight));
    console.log('[OCREngine] scrolling to', offset);
    await sendToActiveTab({ action: 'scrollToY', y: offset });
    await sleep(Math.max(settings.delay, 1200));

    console.log('[OCREngine] capturing visible tab');
    let dataUrl = null;
    let retry = 0;
    while (!dataUrl && retry < 5) {
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      } catch (err) {
        if (err.message && err.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
          console.log('[OCREngine] capture rate limited, retrying in 1s');
          await sleep(1000);
          retry++;
        } else {
          throw err;
        }
      }
    }
    if (!dataUrl) throw new Error('截图失败，超过重试次数');
    console.log('[OCREngine] captured screenshot length:', dataUrl?.length);

    const [cropResult] = await sendToActiveTab({
      action: 'cropScreenshot',
      dataUrl,
      offsetY: offset,
      metrics: m,
      captureArea
    });
    console.log('[OCREngine] crop result:', cropResult ? 'got' : 'null', cropResult?.result ? 'data url length ' + cropResult.result.length : 'no result');

    if (cropResult && cropResult.result) {
      pieces.push(cropResult.result);
      if (onProgress) onProgress({ status: `已截取 ${pieces.length} 段`, progress: offset / m.totalHeight });
    } else if (cropResult && cropResult.error) {
      console.error('[OCREngine] crop error:', cropResult.error);
      throw new Error(cropResult.error);
    }

    if (offset + m.viewportHeight >= m.totalHeight) break;
  }

  console.log('[OCREngine] scroll back to top');
  await sendToActiveTab({ action: 'scrollToY', y: 0 });
  console.log('[OCREngine] captureSequence done, pieces:', pieces.length);
  return { pieces, metrics: m, settings };
}

async function runFullPageOcr(onProgress) {
  console.log('[OCREngine] runFullPageOcr called');
  if (state.isCapturing) {
    console.warn('[OCREngine] already capturing, skip');
    return;
  }
  state.isCapturing = true;
  try {
    const { pieces, settings } = await captureSequence(null, onProgress);
    console.log('[OCREngine] start recognize, pieces:', pieces.length);
    const text = await recognize(pieces, settings.lang);
    console.log('[OCREngine] show result panel');
    await saveToHistory(text, 'full');
    await showResultInContentScript(text, null, 'full');
    return text;
  } catch (err) {
    console.error('[OCREngine] runFullPageOcr error:', err);
    await showResultInContentScript(null, err.message);
    throw err;
  } finally {
    state.isCapturing = false;
  }
}

async function runAreaOcr(area, onProgress) {
  console.log('[OCREngine] runAreaOcr called, area:', area);
  if (state.isCapturing) {
    console.warn('[OCREngine] already capturing, skip');
    return;
  }
  state.isCapturing = true;
  try {
    const { pieces, settings } = await captureSequence(area, onProgress);
    const text = await recognize(pieces, settings.lang);
    await saveToHistory(text, 'area');
    await showResultInContentScript(text, null, 'area');
    return text;
  } catch (err) {
    console.error('[OCREngine] runAreaOcr error:', err);
    await showResultInContentScript(null, err.message);
    throw err;
  } finally {
    state.isCapturing = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] extension installed');
  chrome.contextMenus.create({ id: 'kst-ocr-full', title: '识别整页', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'kst-ocr-area', title: '框选识别', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('[Background] context menu clicked:', info.menuItemId, tab?.id);
  if (info.menuItemId === 'kst-ocr-full') {
    try {
      await runFullPageOcr();
    } catch (err) {
      console.error('[Background] runFullPageOcr failed:', err);
    }
  } else if (info.menuItemId === 'kst-ocr-area') {
    await chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] received message:', request.action, 'from tab', sender.tab?.id);

  if (request.action === 'ocrReady') {
    console.log('[Background] ocrReady message ignored - no longer needed');
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'startFullOcr') {
    runFullPageOcr()
      .then((text) => {
        console.log('[Background] startFullOcr success, text length:', text?.length);
        sendResponse({ text });
      })
      .catch((err) => {
        console.error('[Background] startFullOcr error:', err);
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (request.action === 'startAreaOcr') {
    runAreaOcr(request.area)
      .then((text) => {
        console.log('[Background] startAreaOcr success, text length:', text?.length);
        sendResponse({ text });
      })
      .catch((err) => {
        console.error('[Background] startAreaOcr error:', err);
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (request.action === 'getHistory') {
    (async () => {
      try {
        const history = await getHistoryData();
        console.log('[Background] getHistory returning, count:', history.length, 'first item:', history[0]);
        sendResponse({ history });
      } catch (err) {
        console.error('[Background] getHistory error:', err);
        sendResponse({ history: [], error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'getHistoryInfo') {
    (async () => {
      const [historyList, config] = await Promise.all([getHistoryData(), getConfig()]);
      const size = JSON.stringify(historyList).length;
      const sizeKB = (size / 1024).toFixed(2);
      sendResponse({ count: historyList.length, size: `${sizeKB} KB`, limit: config.historyLimit });
    })();
    return true;
  }

  if (request.action === 'deleteHistoryItem') {
    (async () => {
      const historyList = await getHistoryData();
      const filtered = historyList.filter(item => item.id !== request.id);
      await setHistoryData(filtered);
      sendResponse({ ok: true, history: filtered });
    })();
    return true;
  }

  if (request.action === 'clearHistory') {
    (async () => {
      await setHistoryData([]);
      sendResponse({ ok: true, history: [] });
    })();
    return true;
  }

  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
});

chrome.action.onClicked.addListener((tab) => {
  console.log('[Background] action clicked, tab:', tab?.id);
  chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
});

// 迁移旧版历史记录（旧版本使用 ocrHistory key）
chrome.storage.local.get(['ocrHistory']).then(async (legacyHistory) => {
  if (legacyHistory.ocrHistory && Array.isArray(legacyHistory.ocrHistory)) {
    console.log('[History] migrating legacy history, count:', legacyHistory.ocrHistory.length);
    const existing = await getHistoryData();
    if (existing.length === 0) {
      await setHistoryData(legacyHistory.ocrHistory);
    }
    await chrome.storage.local.remove(['ocrHistory']);
  }
});

initConfig().then(() => {
  console.log('[Background] initialization complete');
});

console.log('[Background] listeners registered');

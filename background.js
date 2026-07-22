console.log('[Background] background.js start');

const state = { isCapturing: false };
let ocrWindowTabId = null;
let ocrWindowCreating = false;
let ocrReadyResolve = null;
let ocrReadyPromise = null;

function waitOcrReady() {
  if (!ocrReadyPromise) {
    ocrReadyPromise = new Promise((resolve) => { ocrReadyResolve = resolve; });
  }
  return ocrReadyPromise;
}

async function setupOcrWindow() {
  if (ocrWindowTabId !== null) {
    try {
      await chrome.tabs.get(ocrWindowTabId);
      console.log('[Background] ocr window tab exists');
      return;
    } catch (e) {
      console.log('[Background] ocr window tab gone');
      ocrWindowTabId = null;
    }
  }
  if (ocrWindowCreating) {
    console.log('[Background] ocr window creating, waiting');
    await waitOcrReady();
    return;
  }
  ocrWindowCreating = true;
  ocrReadyPromise = new Promise((resolve) => { ocrReadyResolve = resolve; });
  try {
    console.log('[Background] creating ocr window');
    const win = await chrome.windows.create({
      url: 'ocr.html',
      type: 'popup',
      width: 400,
      height: 300,
      left: 0,
      top: 0,
      focused: false
    });
    ocrWindowTabId = win.tabs?.[0]?.id;
    console.log('[Background] ocr window created, waiting for ready, tab:', ocrWindowTabId);
    await Promise.race([
      waitOcrReady(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('OCR 窗口初始化超时')), 30000))
    ]);
    console.log('[Background] ocr window ready, tab:', ocrWindowTabId);
  } finally {
    ocrWindowCreating = false;
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
  const s = await chrome.storage.local.get(['lang', 'delay']);
  console.log('[OCREngine] settings:', s);
  return { lang: s.lang || 'chi_sim', delay: s.delay || 300 };
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

async function openResult(text) {
  console.log('[OCREngine] opening result window, text length:', text?.length);
  return new Promise((resolve) => {
    chrome.windows.create({
      url: `result.html?text=${encodeURIComponent(text)}`,
      type: 'popup',
      width: 700,
      height: 600
    }, (win) => {
      console.log('[OCREngine] result window created:', win?.id);
      resolve(win);
    });
  });
}

async function recognize(images, lang) {
  console.log('[OCREngine] recognize start (ocr window), images:', images.length, 'lang:', lang);
  await setupOcrWindow();
  const res = await chrome.tabs.sendMessage(ocrWindowTabId, { action: 'recognizeImages', images, lang });
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
    console.log('[OCREngine] open result');
    await openResult(text);
    return text;
  } catch (err) {
    console.error('[OCREngine] runFullPageOcr error:', err);
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
    await openResult(text);
    return text;
  } catch (err) {
    console.error('[OCREngine] runAreaOcr error:', err);
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
    console.log('[Background] ocr window reported ready');
    if (ocrReadyResolve) ocrReadyResolve();
    sendResponse({ ok: true });
    return true;
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

  if (request.action === 'openResult') {
    chrome.windows.create({
      url: `result.html?text=${encodeURIComponent(request.text)}`,
      type: 'popup',
      width: 700,
      height: 600
    });
    sendResponse({ ok: true });
    return true;
  }
});

chrome.action.onClicked.addListener((tab) => {
  console.log('[Background] action clicked, tab:', tab?.id);
  chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
});

console.log('[Background] listeners registered');

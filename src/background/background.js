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

// ========================================
// OCR 执行模式配置
// ========================================
// 从 config/ocr-mode.json 读取配置
// 'offscreen' - 使用 offscreen document (Manifest V3 推荐，用户完全无感知)
// 'popup' - 使用隐藏的弹出窗口 (兼容性好，但用户可能在任务栏看到)
let OCR_MODE = 'popup'; // 默认值，启动后会从配置文件加载

async function loadOcrMode() {
  try {
    const response = await fetch(chrome.runtime.getURL('config/ocr-mode.json'));
    if (!response.ok) {
      console.warn('[Background] Failed to load ocr-mode.json, using default:', OCR_MODE);
      return;
    }
    const config = await response.json();
    if (config.mode && (config.mode === 'offscreen' || config.mode === 'popup')) {
      OCR_MODE = config.mode;
      console.log('[Background] OCR mode loaded from config:', OCR_MODE);
    } else {
      console.warn('[Background] Invalid mode in ocr-mode.json, using default:', OCR_MODE);
    }
  } catch (err) {
    console.error('[Background] Failed to load OCR mode config:', err);
    console.log('[Background] Using default OCR mode:', OCR_MODE);
  }
}

// 在扩展启动时加载配置
loadOcrMode();
// ========================================

// ========================================
// Offscreen Document 模式
// ========================================
let offscreenDocumentReady = false;
let offscreenDocumentCreating = false;

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

    // 等待 offscreen 脚本加载
    console.log('[Background] waiting for offscreen scripts to load...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 验证 offscreen document 是否真的可用
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Offscreen ping timeout')), 3000);
        chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            console.warn('[Background] offscreen ping failed:', chrome.runtime.lastError.message);
          } else {
            console.log('[Background] offscreen ping success:', response);
          }
          resolve();
        });
      });
    } catch (err) {
      console.warn('[Background] offscreen verification failed:', err.message);
    }
  } catch (err) {
    if (err.message && (err.message.includes('only be created') || err.message.includes('Only a single'))) {
      console.log('[Background] offscreen document already exists (create failed)');
      offscreenDocumentReady = true;
    } else {
      console.error('[Background] failed to create offscreen document:', err);
      throw err;
    }
  } finally {
    offscreenDocumentCreating = false;
  }
}

// ========================================
// Popup Window 模式
// ========================================
let ocrWindow = null;
let ocrWindowReady = false;

async function setupOcrWindow() {
  if (ocrWindowReady && ocrWindow) {
    console.log('[Background] OCR window already ready');
    return;
  }

  console.log('[Background] creating OCR window...');

  return new Promise((resolve, reject) => {
    chrome.windows.create({
      url: 'src/pages/ocr/ocr.html',
      type: 'popup',
      width: 1,
      height: 1,
      left: -1000,
      top: -1000,
      focused: false
    }, (window) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] failed to create OCR window:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      ocrWindow = window;
      console.log('[Background] OCR window created, id:', window.id);

      // 等待窗口加载
      setTimeout(() => {
        ocrWindowReady = true;
        console.log('[Background] OCR window ready');
        resolve();
      }, 2000);
    });
  });
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

async function showResultInContentScript(text, error = null, type = '', tabId = null) {
  console.log('[OCREngine] showing result in content script, text length:', text?.length, 'error:', error, 'tabId:', tabId);

  // 如果没有传入 tabId，尝试查询 active tab（兼容旧代码）
  if (!tabId) {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTabs.length) {
      console.error('[OCREngine] no active tab and no tabId provided');
      return;
    }
    tabId = activeTabs[0].id;
  }

  console.log('[OCREngine] sending showOcrResult to tab:', tabId);
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'showOcrResult',
      text,
      error,
      type,
      title: type === 'full' ? '整页识别结果' : type === 'area' ? '框选识别结果' : type === 'container' ? '容器识别结果' : 'OCR 识别结果'
    });
    console.log('[OCREngine] result panel shown in content script, response:', response);
  } catch (err) {
    console.error('[OCREngine] showOcrResult failed:', err);
  }
}

// ========================================
// PaddleOCR API（在 service worker 中执行，无跨域限制）
// ========================================
const PADDLEOCR_API_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';

async function recognizeWithPaddleOCRAPI(images, config, onProgress) {
  const token = config?.paddleOcrApiToken;
  const model = config?.paddleOcrApiModel || 'PaddleOCR-VL-1.6';

  if (!token) {
    throw new Error('PaddleOCR API token 未设置，请在设置中配置');
  }

  console.log('[PaddleOCR API] Starting recognition, images:', images.length);

  let allText = '';

  for (let i = 0; i < images.length; i++) {
    console.log(`[PaddleOCR API] Processing image ${i + 1}/${images.length}`);

    // 通知进度
    if (onProgress) {
      onProgress({ status: `正在识别 ${i + 1}/${images.length}`, progress: i / images.length });
    }

    // 将 data URL 转为 Blob
    const response = await fetch(images[i]);
    const blob = await response.blob();
    console.log('[PaddleOCR API] Image blob size:', blob.size, 'bytes');

    // 提交任务
    const formData = new FormData();
    formData.append('file', blob, 'image.png');
    formData.append('model', model);
    formData.append('optionalPayload', JSON.stringify({
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false
    }));

    const submitRes = await fetch(PADDLEOCR_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `bearer ${token}` },
      body: formData
    });

    console.log('[PaddleOCR API] Submit response status:', submitRes.status);

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error('[PaddleOCR API] Submit error:', errText);
      throw new Error(`提交任务失败: ${submitRes.status} ${errText}`);
    }

    const submitData = await submitRes.json();
    const jobId = submitData.data?.jobId;
    if (!jobId) throw new Error('API 未返回 jobId');
    console.log('[PaddleOCR API] Job submitted, jobId:', jobId);

    // 轮询任务状态
    let jsonlUrl = '';
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(r => setTimeout(r, 5000));

      const pollRes = await fetch(`${PADDLEOCR_API_URL}/${jobId}`, {
        headers: { 'Authorization': `bearer ${token}` }
      });

      if (!pollRes.ok) throw new Error(`查询任务失败: ${pollRes.status}`);

      const pollData = await pollRes.json();
      const state = pollData.data?.state;
      console.log(`[PaddleOCR API] Job state: ${state}`);

      if (state === 'done') {
        jsonlUrl = pollData.data?.resultUrl?.jsonUrl;
        break;
      } else if (state === 'failed') {
        throw new Error(`任务失败: ${pollData.data?.errorMsg || '未知错误'}`);
      }
    }

    if (!jsonlUrl) throw new Error('任务超时（5分钟）');

    // 获取结果
    console.log('[PaddleOCR API] Fetching result:', jsonlUrl);
    const resultRes = await fetch(jsonlUrl);
    if (!resultRes.ok) throw new Error(`获取结果失败: ${resultRes.status}`);

    const jsonlText = await resultRes.text();
    const lines = jsonlText.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        for (const res of data.result?.layoutParsingResults || []) {
          const md = res.markdown?.text;
          if (md?.trim()) allText += (allText ? '\n' : '') + md.trim();
        }
      } catch (err) {
        console.warn('[PaddleOCR API] Failed to parse line:', err);
      }
    }

    console.log(`[PaddleOCR API] Image ${i + 1} done, text length:`, allText.length);
  }

  return allText.trim() || '(未识别到文字)';
}
async function recognize(images, lang, engine = 'tesseract', config = {}, onProgress) {
  console.log('[OCREngine] recognize start, engine:', engine, 'images:', images.length);

  if (engine === 'paddleocr') {
    return await recognizeWithPaddleOCRAPI(images, config, onProgress);
  }

  // Tesseract 是单次发送全部图片，进度提示只在开始时显示
  if (onProgress && images.length > 1) {
    onProgress({ status: `正在识别 0/${images.length}`, progress: 0 });
  }

  if (OCR_MODE === 'offscreen') {
    return await recognizeWithOffscreen(images, lang, engine, config);
  } else if (OCR_MODE === 'popup') {
    return await recognizeWithPopup(images, lang, engine, config);
  } else {
    throw new Error('Invalid OCR_MODE: ' + OCR_MODE);
  }
}

async function recognizeWithOffscreen(images, lang, engine, config) {
  await setupOffscreenDocument();
  console.log('[OCREngine] sending recognizeImages message to offscreen...');

  try {
    const res = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OCR recognition timeout after 300 seconds'));
      }, 300000); // PaddleOCR API 可能需要更长时间

      let responded = false;

      chrome.runtime.sendMessage(
        {
          action: 'recognizeImages',
          images,
          lang,
          engine,
          target: 'offscreen',
          paddleOcrApiToken: config?.paddleOcrApiToken,
          paddleOcrApiModel: config?.paddleOcrApiModel
        },
        (response) => {
          if (responded) return;
          responded = true;
          clearTimeout(timeout);

          if (chrome.runtime.lastError) {
            console.error('[OCREngine] sendMessage lastError:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('[OCREngine] recognize response received:', response);
            resolve(response);
          }
        }
      );
    });

    console.log('[OCREngine] recognize response:', res);
    if (res?.error) throw new Error(res.error);
    return res?.text || '(未识别到文字)';
  } catch (err) {
    console.error('[OCREngine] recognizeWithOffscreen failed:', err);
    throw err;
  }
}

async function recognizeWithPopup(images, lang, engine, config) {
  await setupOcrWindow();
  console.log('[OCREngine] sending recognizeImages message to OCR window...');

  try {
    const tabs = await chrome.tabs.query({ windowId: ocrWindow.id });
    if (!tabs || tabs.length === 0) {
      throw new Error('OCR window has no tabs');
    }

    const ocrTabId = tabs[0].id;
    console.log('[OCREngine] OCR tab id:', ocrTabId);

    const res = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OCR recognition timeout after 300 seconds'));
      }, 300000); // PaddleOCR API 可能需要更长时间

      chrome.tabs.sendMessage(
        ocrTabId,
        {
          action: 'recognizeImages',
          images,
          lang,
          engine,
          paddleOcrApiToken: config?.paddleOcrApiToken,
          paddleOcrApiModel: config?.paddleOcrApiModel
        },
        (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            console.error('[OCREngine] sendMessage lastError:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('[OCREngine] recognize response received:', response);
            resolve(response);
          }
        }
      );
    });

    console.log('[OCREngine] recognize response:', res);
    if (res?.error) throw new Error(res.error);
    return res?.text || '(未识别到文字)';
  } catch (err) {
    console.error('[OCREngine] recognizeWithPopup failed:', err);
    throw err;
  }
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

  // 确定截取范围
  const isFixed = captureArea?.isFixed;
  const startY = captureArea ? captureArea.y : 0;
  const endY = captureArea ? (captureArea.y + captureArea.height) : m.totalHeight;
  const captureHeight = endY - startY;

  console.log('[OCREngine] capture loop starting, isFixed:', isFixed, 'startY:', startY, 'endY:', endY, 'captureHeight:', captureHeight, 'viewportHeight:', m.viewportHeight, 'totalHeight:', m.totalHeight);

  // 隐藏固定定位元素，避免遮挡截图内容
  const [hideResult] = await sendToActiveTab({ action: 'hideFixedElements' });
  console.log('[OCREngine] hideFixedElements result:', hideResult);

  let loopCount = 0;
  let capturedContentTop = startY;

  try {

  // fixed 元素只需要截一次，不滚动
  if (isFixed) {
    loopCount = 1;
    console.log(`[OCREngine] fixed element: single screenshot at scroll offset 0`);

    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    console.log('[OCREngine] captured screenshot length:', dataUrl?.length);

    const [cropResult] = await sendToActiveTab({
      action: 'cropScreenshot',
      dataUrl,
      offsetY: 0,  // 当前滚动位置为 0（保持原位）
      metrics: m,
      captureArea,
      capturedContentTop: startY
    });
    console.log('[OCREngine] crop result:', cropResult ? 'got' : 'null', cropResult?.result ? 'data url length ' + cropResult.result.length : 'no result');

    if (cropResult && cropResult.result) {
      pieces.push(cropResult.result);

      // DEBUG: 保存截图到临时文件夹
      // try {
      //   const timestamp = Date.now();
      //   const filename = `capture_loop1_fixed_offsetY${Math.round(startY)}_${timestamp}.png`;
      //   await new Promise((res) => {
      //     chrome.downloads.download({
      //       url: cropResult.result,
      //       filename: `temp/${filename}`,
      //       saveAs: false
      //     }, (downloadId) => {
      //       console.log(`[OCREngine DEBUG] saved: temp/${filename} downloadId:${downloadId} lastError:${chrome.runtime.lastError?.message}`);
      //       res();
      //     });
      //   });
      // } catch (err) {
      //   console.error('[OCREngine DEBUG] failed to save temp image:', err);
      // }
    }
  } else {
    // 普通元素：滚动截图
  for (let y = startY; y < endY; y += m.viewportHeight) {
    loopCount++;
    const offset = Math.min(y, Math.max(0, endY - m.viewportHeight));
    console.log(`[OCREngine] loop ${loopCount}: y=${y}, offset=${offset}, capturedTop=${capturedContentTop}, viewportHeight=${m.viewportHeight}`);
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
      captureArea,
      capturedContentTop // 传递已捕获内容的顶部位置
    });
    console.log('[OCREngine] crop result:', cropResult ? 'got' : 'null', cropResult?.result ? 'data url length ' + cropResult.result.length : 'no result');

    if (cropResult && cropResult.result) {
      pieces.push(cropResult.result);

      // DEBUG: 保存截图到临时文件夹
      // try {
      //   const timestamp = Date.now();
      //   const filename = `capture_loop${loopCount}_offset${Math.round(offset)}_capturedTop${Math.round(capturedContentTop)}_${timestamp}.png`;
      //   await new Promise((res) => {
      //     chrome.downloads.download({
      //       url: cropResult.result,
      //       filename: `temp/${filename}`,
      //       saveAs: false
      //     }, (downloadId) => {
      //       console.log(`[OCREngine DEBUG] saved: temp/${filename} downloadId:${downloadId} lastError:${chrome.runtime.lastError?.message}`);
      //       res();
      //     });
      //   });
      // } catch (err) {
      //   console.error('[OCREngine DEBUG] failed to save temp image:', err);
      // }

      // 更新已捕获内容的顶部位置
      const capturedInThisLoop = Math.min(offset + m.viewportHeight, endY) - capturedContentTop;
      capturedContentTop += capturedInThisLoop;
      console.log(`[OCREngine] captured ${capturedInThisLoop}px in this loop, capturedContentTop now at ${capturedContentTop}`);
      if (onProgress) onProgress({ status: `已截取 ${pieces.length} 段`, progress: (capturedContentTop - startY) / captureHeight });
    } else if (cropResult && cropResult.error) {
      console.error('[OCREngine] crop error:', cropResult.error);
      throw new Error(cropResult.error);
    }

    const shouldBreak = offset + m.viewportHeight >= endY;
    console.log(`[OCREngine] loop ${loopCount}: offset(${offset}) + viewportHeight(${m.viewportHeight}) = ${offset + m.viewportHeight}, endY=${endY}, shouldBreak=${shouldBreak}`);
    if (shouldBreak) {
      console.log('[OCREngine] breaking loop, captured all content');
      break;
    }
  }
  } // end else (normal element)
  } finally {
    // 恢复固定定位元素
    console.log('[OCREngine] restoring fixed elements');
    await sendToActiveTab({ action: 'restoreFixedElements' });
  }

  console.log('[OCREngine] scroll back to top');
  await sendToActiveTab({ action: 'scrollToY', y: 0 });
  console.log('[OCREngine] captureSequence done, pieces:', pieces.length);
  return { pieces, metrics: m, settings, tabId: targetTab.id };
}

async function runFullPageOcr(onProgress) {
  console.log('[OCREngine] runFullPageOcr called');
  if (state.isCapturing) {
    console.warn('[OCREngine] already capturing, skip');
    return;
  }
  state.isCapturing = true;
  try {
    const { pieces, settings, tabId } = await captureSequence(null, onProgress);
    console.log('[OCREngine] start recognize, pieces:', pieces.length);
    const text = await recognize(pieces, settings.lang, settings.ocrEngine || 'tesseract', settings, (progress) => {
      // 识别进度回调
      chrome.tabs.sendMessage(tabId, {
        action: 'updateStatus',
        text: progress.status
      }).catch(err => console.warn('[OCREngine] updateStatus failed:', err));
    });
    console.log('[OCREngine] show result panel');
    await saveToHistory(text, 'full');
    await showResultInContentScript(text, null, 'full', tabId);
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
    const { pieces, settings, tabId } = await captureSequence(area, onProgress);
    const text = await recognize(pieces, settings.lang, settings.ocrEngine || 'tesseract', settings, (progress) => {
      chrome.tabs.sendMessage(tabId, {
        action: 'updateStatus',
        text: progress.status
      }).catch(err => console.warn('[OCREngine] updateStatus failed:', err));
    });
    await saveToHistory(text, 'area');
    await showResultInContentScript(text, null, 'area', tabId);
    return text;
  } catch (err) {
    console.error('[OCREngine] runAreaOcr error:', err);
    await showResultInContentScript(null, err.message);
    throw err;
  } finally {
    state.isCapturing = false;
  }
}

async function runContainerOcr(container, onProgress) {
  console.log('[OCREngine] runContainerOcr called, container:', container);
  console.log('[OCREngine] container.isFixed =', container.isFixed, 'typeof =', typeof container.isFixed);
  if (state.isCapturing) {
    console.warn('[OCREngine] already capturing, skip');
    return;
  }
  state.isCapturing = true;
  try {
    const containerHeight = container.scrollHeight || container.height;

    let captureArea;
    if (container.isFixed) {
      // fixed 定位容器：y 是视口坐标，截图不需要滚动，直接用视口坐标裁剪
      // 将视口坐标转为文档坐标（截图时 offset=0）
      captureArea = {
        x: container.x,
        y: container.y,      // 视口坐标，等同于文档坐标（因为不滚动）
        width: container.width,
        height: containerHeight,
        isFixed: true
      };
    } else {
      captureArea = {
        x: container.x,
        y: container.y,
        width: container.width,
        height: containerHeight
      };
    }
    console.log('[OCREngine] container capture area:', captureArea);
    console.log('[OCREngine] will capture from Y=' + captureArea.y + ' to Y=' + (captureArea.y + containerHeight));

    const { pieces, settings, tabId } = await captureSequence(captureArea, onProgress);
    const text = await recognize(pieces, settings.lang, settings.ocrEngine || 'tesseract', settings, (progress) => {
      chrome.tabs.sendMessage(tabId, {
        action: 'updateStatus',
        text: progress.status
      }).catch(err => console.warn('[OCREngine] updateStatus failed:', err));
    });
    await saveToHistory(text, 'container');
    await showResultInContentScript(text, null, 'container', tabId);
    return text;
  } catch (err) {
    console.error('[OCREngine] runContainerOcr error:', err);
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
  chrome.contextMenus.create({ id: 'kst-ocr-container', title: '容器识别', contexts: ['page'] });
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
  } else if (info.menuItemId === 'kst-ocr-container') {
    await chrome.tabs.sendMessage(tab.id, { action: 'startContainerSelection' });
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

  if (request.action === 'startContainerOcr') {
    runContainerOcr(request.container)
      .then((text) => {
        console.log('[Background] startContainerOcr success, text length:', text?.length);
        sendResponse({ text });
      })
      .catch((err) => {
        console.error('[Background] startContainerOcr error:', err);
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

  // 对于未处理的消息（如 recognizeImages），返回 false 让其传递到其他监听器（offscreen document）
  console.log('[Background] message not handled, passing through:', request.action);
  return false;
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

// 初始化配置和 OCR 模式
Promise.all([initConfig(), loadOcrMode()]).then(() => {
  console.log('[Background] OCR mode:', OCR_MODE);
  console.log('[Background] initialization complete');
});

console.log('[Background] listeners registered');

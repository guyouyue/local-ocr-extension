let overlayRoot = null;
let tesseractReady = false;
let tesseractLoading = null;

console.log('[Content] content script loaded, location:', location.href);

function loadTesseractScript() {
  if (tesseractLoading) return tesseractLoading;
  tesseractLoading = new Promise((resolve, reject) => {
    if (typeof Tesseract !== 'undefined' && Tesseract.createWorker) {
      console.log('[Content] Tesseract already loaded');
      tesseractReady = true;
      return resolve();
    }
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('libs/tesseract/tesseract.min.js');
    script.onload = () => {
      console.log('[Content] Tesseract script loaded, createWorker:', typeof Tesseract?.createWorker);
      if (typeof Tesseract?.createWorker !== 'function') {
        return reject(new Error('Tesseract.createWorker 不可用'));
      }
      tesseractReady = true;
      resolve();
    };
    script.onerror = (err) => reject(new Error('Tesseract script load failed'));
    document.head.appendChild(script);
  });
  return tesseractLoading;
}

function errorToString(err) {
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string') return err.message;
  return JSON.stringify(err) || '未知错误';
}

async function recognizeImages(images, lang, baseUrl) {
  showStatus('正在加载 OCR 引擎…');
  try {
    await loadTesseractScript();
  } catch (err) {
    console.error('[Content] loadTesseractScript error:', err);
    throw err;
  }
  console.log('[Content] recognizeImages start, images:', images.length, 'lang:', lang, 'base:', baseUrl);
  showStatus('正在初始化 OCR Worker…');

  const workerOptions = {
    logger: (m) => {
      console.log('[Content] tesseract logger:', m.status, m.progress);
      showStatus(`OCR: ${m.status} ${Math.round((m.progress || 0) * 100)}%`);
    },
    errorHandler: (err) => console.error('[Content] worker error:', err)
  };

  // Use CDN defaults from Tesseract.js v7 to avoid chrome-extension protocol issues
  // Default workerPath: https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/worker.min.js
  // Default corePath: https://cdn.jsdelivr.net/npm/tesseract.js-core@v4.0.3/
  // Default langPath: https://tessdata.projectnaptha.com/4.0.0_best_int/
  console.log('[Content] createWorker options:', workerOptions);
  let worker;
  try {
    worker = await Tesseract.createWorker(lang, 1, workerOptions);
  } catch (err) {
    console.error('[Content] createWorker failed:', err);
    throw new Error('createWorker 失败: ' + errorToString(err));
  }
  console.log('[Content] worker created');

  let allText = '';
  for (let i = 0; i < images.length; i++) {
    showStatus(`正在识别第 ${i + 1}/${images.length} 段…`);
    console.log('[Content] recognizing image', i + 1, '/', images.length);
    try {
      const { data: { text } } = await worker.recognize(images[i]);
      console.log('[Content] image', i + 1, 'recognized text length:', text?.length);
      if (text.trim()) allText += `\n--- 分段 ${i + 1} ---\n${text.trim()}`;
    } catch (err) {
      console.error('[Content] recognize image error:', err);
    }
  }
  await worker.terminate();
  console.log('[Content] recognizeImages done, total length:', allText.length);
  hideStatus();
  return allText.trim() || '(未识别到文字)';
}

function showStatus(text) {
  console.log('[Content] showStatus:', text);
  if (overlayRoot) overlayRoot.remove();
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'kst-ocr-status';
  overlayRoot.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    background: rgba(0,0,0,0.8);
    color: #fff;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: sans-serif;
    font-size: 14px;
    pointer-events: none;
    max-width: 260px;
    line-height: 1.4;
  `;
  overlayRoot.textContent = text;
  document.body.appendChild(overlayRoot);
}

function hideStatus() {
  console.log('[Content] hideStatus');
  if (overlayRoot) {
    overlayRoot.remove();
    overlayRoot = null;
  }
}

function getPageMetrics(captureArea = null) {
  console.log('[Content] getPageMetrics called, captureArea:', captureArea);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const doc = document.documentElement;
  const body = document.body;
  const fullWidth = captureArea ? captureArea.width : Math.max(doc.scrollWidth, body.scrollWidth);
  const fullHeight = captureArea ? captureArea.height : Math.max(doc.scrollHeight, body.scrollHeight);

  const metrics = {
    viewportWidth: width,
    viewportHeight: height,
    totalWidth: fullWidth,
    totalHeight: fullHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    captureArea: captureArea ? { x: captureArea.x, y: captureArea.y, width: captureArea.width, height: captureArea.height } : null
  };
  console.log('[Content] metrics:', metrics);
  return metrics;
}

function scrollToY(y) {
  console.log('[Content] scrollToY:', y);
  window.scrollTo(0, y);
}

function cropScreenshot(dataUrl, offsetY, metrics, captureArea) {
  console.log('[Content] cropScreenshot called, dataUrl length:', dataUrl?.length, 'offsetY:', offsetY, 'captureArea:', captureArea);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      console.log('[Content] image loaded size:', img.width, 'x', img.height);
      const dpr = metrics.devicePixelRatio;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const vpW = metrics.viewportWidth * dpr;
      const vpH = metrics.viewportHeight * dpr;

      let srcX = 0;
      let srcY = 0;
      let srcW = vpW;
      let srcH = Math.min(vpH, img.height);

      if (captureArea) {
        const ax = captureArea.x * dpr;
        const ay = captureArea.y * dpr;
        const aw = captureArea.width * dpr;
        const ah = captureArea.height * dpr;
        const offsetYPx = offsetY * dpr;

        if (ay + ah <= offsetYPx || ay >= offsetYPx + vpH) {
          console.log('[Content] area out of current viewport, skip');
          return resolve(null);
        }

        srcX = ax;
        srcY = Math.max(0, ay - offsetYPx);
        const maxSrcH = vpH - srcY;
        srcW = aw;
        srcH = Math.min(ah, maxSrcH);
      }

      canvas.width = srcW;
      canvas.height = srcH;
      console.log('[Content] cropping canvas:', srcW, 'x', srcH, 'from', srcX, srcY);
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      resolve({ result: canvas.toDataURL('image/png') });
    };
    img.onerror = (err) => {
      console.error('[Content] image load error:', err);
      resolve({ error: '截图加载失败' });
    };
    img.src = dataUrl;
  });
}

function startAreaSelection() {
  console.log('[Content] startAreaSelection called');
  const overlayId = 'kst-ocr-overlay';
  if (document.getElementById(overlayId)) {
    console.log('[Content] overlay already exists');
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483647;
    cursor: crosshair;
    background: rgba(0,0,0,0.3);
  `;

  const selection = document.createElement('div');
  selection.style.cssText = `
    position: absolute;
    border: 2px dashed #1a73e8;
    background: rgba(26,115,232,0.15);
    display: none;
  `;
  overlay.appendChild(selection);
  document.body.appendChild(overlay);

  let startX = 0;
  let startY = 0;

  function onMouseDown(e) {
    startX = e.clientX;
    startY = e.clientY;
    selection.style.left = `${startX}px`;
    selection.style.top = `${startY}px`;
    selection.style.width = '0px';
    selection.style.height = '0px';
    selection.style.display = 'block';
  }

  function onMouseMove(e) {
    if (selection.style.display === 'none') return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    selection.style.left = `${x}px`;
    selection.style.top = `${y}px`;
    selection.style.width = `${Math.abs(e.clientX - startX)}px`;
    selection.style.height = `${Math.abs(e.clientY - startY)}px`;
  }

  async function onMouseUp(e) {
    overlay.removeEventListener('mousedown', onMouseDown);
    overlay.removeEventListener('mousemove', onMouseMove);
    overlay.removeEventListener('mouseup', onMouseUp);
    overlay.remove();

    const x = Math.min(e.clientX, startX) + window.scrollX;
    const y = Math.min(e.clientY, startY) + window.scrollY;
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);

    if (width < 10 || height < 10) return;

    console.log('[Content] area selected:', { x, y, width, height });
    try {
      showStatus('正在识别框选区域…');
      await chrome.runtime.sendMessage({ action: 'startAreaOcr', area: { x, y, width, height } });
    } catch (err) {
      console.error('[Content] startAreaOcr failed:', err);
      hideStatus();
    }
  }

  overlay.addEventListener('mousedown', onMouseDown);
  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('mouseup', onMouseUp);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Content] received message:', request.action, 'from:', sender?.id);

  if (request.action === 'ping') {
    sendResponse({ ok: true });
    return true;
  }
  if (request.action === 'getPageMetrics') {
    try {
      const metrics = getPageMetrics(request.captureArea);
      console.log('[Content] sending metrics:', metrics);
      sendResponse(metrics);
    } catch (err) {
      console.error('[Content] getPageMetrics error:', err);
      sendResponse({ error: errorToString(err) });
    }
    return true;
  }
  if (request.action === 'scrollToY') {
    try {
      scrollToY(request.y);
      sendResponse({ ok: true });
    } catch (err) {
      console.error('[Content] scrollToY error:', err);
      sendResponse({ error: errorToString(err) });
    }
    return true;
  }
  if (request.action === 'cropScreenshot') {
    cropScreenshot(request.dataUrl, request.offsetY, request.metrics, request.captureArea)
      .then((res) => {
        console.log('[Content] cropScreenshot resolved:', res ? (res.length ? 'data url length ' + res.length : res) : 'null');
        sendResponse(res);
      })
      .catch((err) => {
        console.error('[Content] cropScreenshot error:', err);
        sendResponse({ error: errorToString(err) });
      });
    return true;
  }
  if (request.action === 'startAreaSelection') {
    try {
      startAreaSelection();
      sendResponse({ ok: true });
    } catch (err) {
      console.error('[Content] startAreaSelection error:', err);
      sendResponse({ error: errorToString(err) });
    }
    return true;
  }
  if (request.action === 'recognizeImages') {
    console.log('[Content] recognizeImages message received');
    recognizeImages(request.images, request.lang, request.baseUrl)
      .then((text) => {
        console.log('[Content] recognizeImages success, text length:', text?.length);
        sendResponse({ text });
      })
      .catch((err) => {
        const msg = errorToString(err);
        console.error('[Content] recognizeImages error:', msg, err);
        sendResponse({ error: msg });
      });
    return true;
  }
});

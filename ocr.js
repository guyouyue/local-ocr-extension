console.log('[OCR] loaded');

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
  console.log('[OCR] status:', text);
}

function log(text) {
  const el = document.getElementById('log');
  if (el) el.textContent += text + '\n';
  console.log('[OCR] log:', text);
}

setStatus('OCR worker loaded, checking Tesseract…');

function errorToString(err) {
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string') return err.message;
  return JSON.stringify(err) || '未知错误';
}

async function recognizeImages(images, lang) {
  log('recognizeImages start, images: ' + (images?.length || 0) + ' lang: ' + lang);
  if (typeof Tesseract === 'undefined' || typeof Tesseract.createWorker !== 'function') {
    throw new Error('Tesseract 未加载');
  }

  setStatus('Initializing Tesseract worker…');
  const workerOptions = {
    logger: (m) => {
      const msg = (m.status || '') + ' ' + Math.round((m.progress || 0) * 100) + '%';
      setStatus(msg);
      log(msg);
    },
    errorHandler: (err) => {
      const msg = errorToString(err);
      log('worker error: ' + msg);
      console.error('[OCR] worker error:', err);
    },
    workerPath: chrome.runtime.getURL('libs/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('libs/tesseract/'),
    langPath: chrome.runtime.getURL('libs/tessdata/'),
    gzip: false,
    workerBlobURL: false
  };
  let worker;
  try {
    worker = await Tesseract.createWorker(lang, 1, workerOptions);
  } catch (err) {
    const msg = errorToString(err);
    log('createWorker failed: ' + msg);
    throw new Error('createWorker 失败: ' + msg);
  }

  setStatus('Worker ready, recognizing…');
  let allText = '';
  for (let i = 0; i < images.length; i++) {
    log('recognizing image ' + (i + 1) + '/' + images.length);
    try {
      const { data: { text } } = await worker.recognize(images[i]);
      log('image ' + (i + 1) + ' text length: ' + (text?.length || 0));
      if (text.trim()) allText += '\n--- 分段 ' + (i + 1) + ' ---\n' + text.trim();
    } catch (err) {
      const msg = errorToString(err);
      log('recognize image error: ' + msg);
      console.error('[OCR] recognize image error:', err);
    }
  }
  await worker.terminate();
  setStatus('Recognition done');
  log('recognizeImages done, total length: ' + allText.length);
  return allText.trim() || '(未识别到文字)';
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log('received message: ' + request.action);
  if (request.action === 'recognizeImages') {
    recognizeImages(request.images, request.lang)
      .then((text) => {
        log('recognizeImages success, length: ' + text.length);
        sendResponse({ text });
      })
      .catch((err) => {
        const msg = errorToString(err);
        log('recognizeImages error: ' + msg);
        console.error('[OCR] recognizeImages error:', err);
        sendResponse({ error: msg });
      });
    return true;
  }
  sendResponse({ error: '未知 action' });
  return true;
});

// Report ready after Tesseract script has loaded
try {
  if (typeof Tesseract !== 'undefined' && Tesseract.createWorker) {
    setStatus('Tesseract ready, reporting to background');
  } else {
    setStatus('Tesseract not loaded, reporting anyway');
  }
  chrome.runtime.sendMessage({ action: 'ocrReady' })
    .then(() => log('ready message sent'))
    .catch((err) => log('ready message error: ' + errorToString(err)));
} catch (err) {
  log('send ready error: ' + errorToString(err));
}

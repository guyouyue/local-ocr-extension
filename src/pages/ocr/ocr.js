console.log('[OCR] loaded');

let paddleOCRAPI = null;

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

setStatus('OCR worker loaded, checking libraries…');

function errorToString(err) {
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string') return err.message;
  return JSON.stringify(err) || '未知错误';
}

async function recognizeWithTesseract(images, lang) {
  log('recognizeWithTesseract start, images: ' + images.length + ' lang: ' + lang);

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

  const worker = await Tesseract.createWorker(lang, 1, workerOptions);

  // 优化参数
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: '',
    textord_heavy_nr: '1',
    language_model_penalty_non_dict_word: '0.5',
    language_model_penalty_non_freq_dict_word: '0.5'
  });

  setStatus('Worker ready, recognizing…');
  let allText = '';
  for (let i = 0; i < images.length; i++) {
    log('recognizing image ' + (i + 1) + '/' + images.length);
    const { data: { text } } = await worker.recognize(images[i]);
    log('image ' + (i + 1) + ' text length: ' + (text?.length || 0));
    if (text.trim()) {
      allText += (allText ? '\n' : '') + text.trim();
    }
  }
  await worker.terminate();
  setStatus('Tesseract recognition done');
  log('recognizeWithTesseract done, total length: ' + allText.length);
  return allText.trim() || '(未识别到文字)';
}

async function recognizeWithPaddleOCR(images, token, model) {
  log('recognizeWithPaddleOCR start, images: ' + images.length);

  if (!token) {
    throw new Error('PaddleOCR API token 未设置，请在设置中配置');
  }

  // 初始化 API 客户端
  if (!paddleOCRAPI) {
    log('initializing PaddleOCR API client...');
    setStatus('Initializing PaddleOCR API…');

    if (typeof PaddleOCRAPI === 'undefined') {
      throw new Error('PaddleOCR API 客户端未加载');
    }

    paddleOCRAPI = new PaddleOCRAPI();
    paddleOCRAPI.setToken(token);
    paddleOCRAPI.setModel(model || 'PaddleOCR-VL-1.6');
    log('PaddleOCR API client initialized');
  }

  setStatus('PaddleOCR API recognizing…');
  let allText = '';

  for (let i = 0; i < images.length; i++) {
    log('recognizing image ' + (i + 1) + '/' + images.length);

    try {
      const text = await paddleOCRAPI.recognize(images[i], (progress) => {
        setStatus(progress);
        log(progress);
      });

      log('image ' + (i + 1) + ' text length: ' + (text?.length || 0));
      if (text.trim()) {
        allText += (allText ? '\n' : '') + text.trim();
      }
    } catch (err) {
      log('PaddleOCR API recognition failed for image ' + (i + 1) + ': ' + errorToString(err));
      throw err;
    }
  }

  setStatus('PaddleOCR API recognition done');
  log('recognizeWithPaddleOCR done, total length: ' + allText.length);
  return allText.trim() || '(未识别到文字)';
}

async function recognizeImages(images, lang, engine, token, model) {
  log('recognizeImages start, images: ' + images.length + ' lang: ' + lang + ' engine: ' + engine);

  if (engine === 'paddleocr') {
    return await recognizeWithPaddleOCR(images, token, model);
  } else {
    return await recognizeWithTesseract(images, lang);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log('received message: ' + request.action);
  if (request.action === 'recognizeImages') {
    recognizeImages(request.images, request.lang, request.engine, request.paddleOcrApiToken, request.paddleOcrApiModel)
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

// Report ready after libraries loaded
setTimeout(() => {
  try {
    const tesseractOk = typeof Tesseract !== 'undefined' && Tesseract.createWorker;
    const paddleOk = typeof PaddleOCRAPI !== 'undefined';

    log('Libraries loaded - Tesseract: ' + tesseractOk + ', PaddleOCR API: ' + paddleOk);
    setStatus('OCR worker ready');
  } catch (err) {
    log('library check error: ' + errorToString(err));
  }
}, 100);

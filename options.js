document.addEventListener('DOMContentLoaded', async () => {
  const langInput = document.getElementById('lang');
  const delayInput = document.getElementById('delay');
  const saveBtn = document.getElementById('save');
  const tip = document.getElementById('tip');

  const stored = await chrome.storage.local.get(['lang', 'delay']);
  if (stored.lang) langInput.value = stored.lang;
  if (stored.delay != null) delayInput.value = stored.delay;

  saveBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      lang: langInput.value.trim(),
      delay: parseInt(delayInput.value, 10) || 300
    });
    tip.textContent = '已保存';
    setTimeout(() => tip.textContent = '', 2000);
  });
});

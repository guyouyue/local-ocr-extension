document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] loaded');

  const status = document.getElementById('status');
  if (status) status.textContent = '请使用页面右下角悬浮球操作';
});

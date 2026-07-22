document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const text = params.get('text') || '';
  const output = document.getElementById('output');
  output.textContent = text;

  document.getElementById('copy').addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => alert('已复制'));
  });

  document.getElementById('download').addEventListener('click', () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ocr-${Date.now()}.txt`;
    a.click();
  });
});

document.getElementById('go').addEventListener('click', async () => {
  const msg = document.getElementById('msg');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg.textContent = 'Done. You can close this tab.';
  } catch {
    msg.textContent = 'The microphone is blocked. Click the icon at the right of the address bar to allow it, then try again.';
  }
});

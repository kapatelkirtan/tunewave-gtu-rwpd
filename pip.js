/* TuneWave YouTube Picture-in-Picture helper.
   Document PiP is supported by desktop browsers such as Chrome/Edge, but not Chrome on Android.
   The YouTube iframe itself remains the official YouTube player. */
(() => {
  'use strict';

  const stage = document.getElementById('official-player-stage');
  const frame = document.getElementById('official-player-frame');
  const status = document.getElementById('official-player-status');
  if (!stage || !frame) return;

  const style = document.createElement('style');
  style.textContent = [
    '.official-player-pip-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;margin:0 0 12px;padding:0 14px;border:1px solid rgba(80,232,255,.32);border-radius:10px;background:linear-gradient(135deg,rgba(80,232,255,.12),rgba(217,255,57,.08));color:#dffaff;font:700 12px/1.2 system-ui,sans-serif;cursor:pointer;touch-action:manipulation}',
    '.official-player-pip-button:hover{border-color:rgba(80,232,255,.7);background:rgba(80,232,255,.16)}',
    '.official-player-pip-button:focus-visible{outline:2px solid #50e8ff;outline-offset:3px}',
    '.official-player-pip-help{margin:0 0 12px;color:#9fb0bc;font-size:12px;line-height:1.6}'
  ].join('');
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'official-player-pip-button';
  button.textContent = '▣ Open floating player (PiP)';
  button.setAttribute('aria-label', 'Open the YouTube player in a floating Picture-in-Picture window');
  stage.insertBefore(button, frame);

  const help = document.createElement('p');
  help.className = 'official-player-pip-help';
  help.textContent = 'PiP availability depends on your browser. On Android Chrome, this website cannot create a floating PiP window for an embedded YouTube song.';
  stage.insertBefore(help, frame);

  let pipWindow = null;
  let placeholder = null;
  let originalStyle = null;
  let originalTitle = null;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function restoreFrame() {
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(frame, placeholder);
      placeholder.remove();
    }
    placeholder = null;
    if (originalStyle === null) frame.removeAttribute('style');
    else if (originalStyle !== undefined) frame.setAttribute('style', originalStyle);
    originalStyle = null;
    if (originalTitle !== null) frame.title = originalTitle;
    originalTitle = null;
    frame.hidden = false;
    pipWindow = null;
    button.textContent = '▣ Open floating player (PiP)';
  }

  function openUnsupportedHelp() {
    setStatus('PiP is not available for this embedded YouTube player in this browser. On Android Chrome, try “Open this song in YouTube” and use YouTube’s own PiP option where eligible. YouTube restricts PiP for many music videos to Premium members.');
  }

  button.addEventListener('click', async () => {
    const src = frame.getAttribute('src');
    if (!src) {
      setStatus('Paste a YouTube song or playlist link and tap Play here first.');
      return;
    }

    if (!('documentPictureInPicture' in window) ||
        !window.documentPictureInPicture ||
        typeof window.documentPictureInPicture.requestWindow !== 'function') {
      openUnsupportedHelp();
      return;
    }

    try {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.focus();
        return;
      }

      pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 480,
        height: 320
      });

      const pipDoc = pipWindow.document;
      pipDoc.documentElement.style.cssText = 'height:100%;margin:0;background:#070a0e;';
      pipDoc.body.style.cssText = 'height:100%;margin:0;overflow:hidden;background:#070a0e;color:#eaf8ff;font-family:system-ui,-apple-system,sans-serif;';
      const pipStyle = pipDoc.createElement('style');
      pipStyle.textContent = [
        '*{box-sizing:border-box}',
        '.tw-pip-shell{height:100%;display:flex;flex-direction:column;gap:5px;padding:7px;background:#070a0e}',
        '.tw-pip-bar{height:28px;min-height:28px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:#dffaff;font-size:11px;font-weight:700;letter-spacing:.02em}',
        '.tw-pip-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.tw-pip-back{flex:0 0 auto;border:1px solid rgba(80,232,255,.35);border-radius:7px;background:#111d25;color:#dffaff;padding:5px 8px;font-size:10px;font-weight:700;cursor:pointer}',
        '.tw-pip-video{display:block;flex:1 1 auto;width:100%;height:calc(100% - 33px);min-height:0;border:0;border-radius:7px;background:#000}'
      ].join('');
      pipDoc.head.appendChild(pipStyle);

      const shell = pipDoc.createElement('div');
      shell.className = 'tw-pip-shell';
      const bar = pipDoc.createElement('div');
      bar.className = 'tw-pip-bar';
      const label = pipDoc.createElement('span');
      label.textContent = 'TuneWave · YouTube player';
      const back = pipDoc.createElement('button');
      back.type = 'button';
      back.className = 'tw-pip-back';
      back.textContent = 'Return';
      bar.append(label, back);
      shell.appendChild(bar);
      pipDoc.body.appendChild(shell);

      placeholder = document.createComment('TuneWave YouTube player PiP placeholder');
      frame.parentNode.insertBefore(placeholder, frame);
      originalStyle = frame.getAttribute('style');
      originalTitle = frame.title;
      frame.style.cssText = 'display:block!important;flex:1 1 auto;width:100%;height:calc(100% - 33px);min-height:0;border:0;border-radius:7px;background:#000;';
      frame.title = 'TuneWave floating YouTube player';
      frame.hidden = false;
      frame.classList.add('tw-pip-video');
      shell.appendChild(frame);

      const removeTempClass = () => frame.classList.remove('tw-pip-video');
      back.addEventListener('click', () => {
        const windowToClose = pipWindow;
        restoreFrame();
        removeTempClass();
        try { if (windowToClose && !windowToClose.closed) windowToClose.close(); } catch (_) {}
        setStatus('Returned the YouTube player to TuneWave.');
      });
      pipWindow.addEventListener('pagehide', () => {
        restoreFrame();
        removeTempClass();
      }, { once: true });

      button.textContent = '▣ Floating player is open';
      setStatus('YouTube player moved to a floating PiP window. Close the PiP window or tap Return to put it back here.');
    } catch (error) {
      restoreFrame();
      frame.classList.remove('tw-pip-video');
      if (error && error.name === 'NotAllowedError') {
        setStatus('Your browser blocked PiP. Tap the PiP button again from this page, or use the browser’s built-in Picture-in-Picture option if available.');
      } else {
        setStatus('This browser could not open a floating PiP window. You can still play the song in TuneWave’s embedded YouTube player.');
      }
    }
  });
})();
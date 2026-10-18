/* TuneWave Picture-in-Picture helper for pasted YouTube links only.
   Desktop browsers can use Document Picture-in-Picture. On Android, the button
   tries fullscreen so the browser/OS can offer its own video PiP if eligible.
   YouTube and the browser remain in control of PiP availability. */
(() => {
  'use strict';

  const stage = document.getElementById('official-player-stage');
  const frame = document.getElementById('official-player-frame');
  const status = document.getElementById('official-player-status');
  if (!stage || !frame) return;

  const isAndroid = /Android/i.test(navigator.userAgent || '');
  const canDocumentPiP = !isAndroid &&
    'documentPictureInPicture' in window &&
    window.documentPictureInPicture &&
    typeof window.documentPictureInPicture.requestWindow === 'function';

  const style = document.createElement('style');
  style.textContent = [
    '.official-player-pip-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;margin:0 0 12px;padding:0 14px;border:1px solid rgba(80,232,255,.32);border-radius:10px;background:linear-gradient(135deg,rgba(80,232,255,.12),rgba(217,255,57,.08));color:#dffaff;font:700 12px/1.2 system-ui,sans-serif;cursor:pointer;touch-action:manipulation}',
    '.official-player-pip-button:hover{border-color:rgba(80,232,255,.7);background:rgba(80,232,255,.16)}',
    '.official-player-pip-button:focus-visible{outline:2px solid #50e8ff;outline-offset:3px}',
    '.official-player-pip-help{margin:0 0 12px;color:#9fb0bc;font-size:12px;line-height:1.6}',
    '#official-player-frame.tw-pip-fullscreen-target:fullscreen{display:block!important;width:100vw!important;height:100vh!important;max-width:none!important;min-height:100vh!important;border:0!important;background:#000!important}'
  ].join('');
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'official-player-pip-button';
  button.textContent = canDocumentPiP ? '▣ Open floating player (PiP)' : '▣ Try Picture-in-Picture';
  button.setAttribute('aria-label', 'Try Picture-in-Picture for the YouTube song pasted into TuneWave');
  stage.insertBefore(button, frame);

  const help = document.createElement('p');
  help.className = 'official-player-pip-help';
  help.textContent = canDocumentPiP
    ? 'On desktop Chrome or Edge, open a floating player. On mobile, PiP must be provided by the browser and YouTube player.'
    : 'On Android, tap this while the song is playing, then swipe Home to try system PiP. Support depends on the browser and the YouTube video.';
  stage.insertBefore(help, frame);

  let pipWindow = null;
  let placeholder = null;
  let pipOriginalStyle = null;
  let pipOriginalTitle = null;
  let fullscreenOriginalStyle = null;
  let fullscreenMode = false;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function restoreFullscreenStyle() {
    if (fullscreenOriginalStyle !== null) {
      if (fullscreenOriginalStyle === '') frame.removeAttribute('style');
      else frame.setAttribute('style', fullscreenOriginalStyle);
    }
    fullscreenOriginalStyle = null;
    frame.classList.remove('tw-pip-fullscreen-target');
    fullscreenMode = false;
    button.textContent = canDocumentPiP ? '▣ Open floating player (PiP)' : '▣ Try Picture-in-Picture';
  }

  function restoreDocumentPiPFrame() {
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(frame, placeholder);
      placeholder.remove();
    }
    placeholder = null;
    if (pipOriginalStyle === null) frame.removeAttribute('style');
    else frame.setAttribute('style', pipOriginalStyle);
    pipOriginalStyle = null;
    if (pipOriginalTitle !== null) frame.title = pipOriginalTitle;
    pipOriginalTitle = null;
    frame.hidden = false;
    if (pipWindow && !pipWindow.closed) {
      const oldWindow = pipWindow;
      pipWindow = null;
      try { oldWindow.close(); } catch (_) {}
    } else {
      pipWindow = null;
    }
    button.textContent = '▣ Open floating player (PiP)';
  }

  function closePip() {
    if (document.fullscreenElement === frame && document.exitFullscreen) {
      try { document.exitFullscreen(); } catch (_) {}
    }
    if (fullscreenMode) restoreFullscreenStyle();
    if (pipWindow || placeholder) restoreDocumentPiPFrame();
  }

  // Let the page's existing stop/reset logic restore the player before replacing a link.
  window.TuneWaveYouTubePiP = { close: closePip };

  document.addEventListener('fullscreenchange', () => {
    if (fullscreenMode && document.fullscreenElement !== frame) restoreFullscreenStyle();
  });

  function tryFullscreenPiP() {
    if (!frame.requestFullscreen) {
      setStatus('This browser cannot request fullscreen for the embedded YouTube player. PiP is controlled by the browser and YouTube; try the YouTube player’s own fullscreen/PiP controls if available.');
      return;
    }

    fullscreenOriginalStyle = frame.getAttribute('style') || '';
    fullscreenMode = true;
    frame.classList.add('tw-pip-fullscreen-target');
    frame.style.setProperty('display', 'block', 'important');
    frame.style.setProperty('width', '100vw', 'important');
    frame.style.setProperty('height', '100vh', 'important');
    frame.style.setProperty('max-width', 'none', 'important');
    frame.style.setProperty('min-height', '100vh', 'important');

    let request;
    try {
      request = frame.requestFullscreen({ navigationUI: 'hide' });
    } catch (_) {
      try { request = frame.requestFullscreen(); } catch (error) { request = Promise.reject(error); }
    }

    Promise.resolve(request).then(() => {
      button.textContent = '▣ Fullscreen active — swipe Home';
      if (isAndroid) {
        setStatus('The YouTube player is fullscreen. Keep the song playing, then swipe up to Home or press Home to try Android PiP. The browser may not offer PiP for every YouTube music video.');
      } else {
        setStatus('The player is fullscreen. If your browser supports video PiP, use its PiP option or leave fullscreen while playback is active. TuneWave cannot force PiP in this browser.');
      }
    }).catch(() => {
      restoreFullscreenStyle();
      setStatus('Fullscreen/PiP was blocked by this browser. Play the YouTube song in the embedded player; any floating-player option is controlled by your browser and YouTube.');
    });
  }

  async function openDocumentPiP() {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.focus();
      return;
    }

    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 480, height: 320 });
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
    pipOriginalStyle = frame.getAttribute('style');
    pipOriginalTitle = frame.title;
    frame.style.cssText = 'display:block!important;flex:1 1 auto;width:100%;height:calc(100% - 33px);min-height:0;border:0;border-radius:7px;background:#000;';
    frame.title = 'TuneWave floating YouTube player';
    frame.hidden = false;
    frame.classList.add('tw-pip-video');
    shell.appendChild(frame);

    back.addEventListener('click', () => {
      restoreDocumentPiPFrame();
      setStatus('Returned the YouTube player to TuneWave.');
    });
    pipWindow.addEventListener('pagehide', () => {
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.insertBefore(frame, placeholder);
        placeholder.remove();
      }
      placeholder = null;
      if (pipOriginalStyle === null) frame.removeAttribute('style');
      else frame.setAttribute('style', pipOriginalStyle);
      pipOriginalStyle = null;
      if (pipOriginalTitle !== null) frame.title = pipOriginalTitle;
      pipOriginalTitle = null;
      frame.hidden = false;
      frame.classList.remove('tw-pip-video');
      pipWindow = null;
      button.textContent = '▣ Open floating player (PiP)';
    }, { once: true });

    button.textContent = '▣ Floating player is open';
    setStatus('The YouTube player moved to a floating window. Close it or tap Return to put it back in TuneWave.');
  }

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const src = frame.getAttribute('src');
    if (!src) {
      setStatus('Paste a YouTube song or playlist link and tap Play here first.');
      return;
    }
    button.disabled = true;
    try {
      if (canDocumentPiP) await openDocumentPiP();
      else tryFullscreenPiP();
    } catch (error) {
      if (error && error.name === 'NotAllowedError') {
        setStatus('Your browser blocked PiP. Start the YouTube song first, then tap this button again; browser and YouTube eligibility rules still apply.');
      } else {
        setStatus('This browser could not open a floating PiP window. You can still play the song in TuneWave’s embedded YouTube player.');
      }
    } finally {
      button.disabled = false;
    }
  });
})();
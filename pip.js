/* TuneWave compact PiP / mini-player helper for pasted YouTube links only.
   Desktop uses a compact Document Picture-in-Picture window when supported.
   Other browsers get a small floating mini-player inside the TuneWave page.
   True OS-level PiP remains controlled by the browser and YouTube. */
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
    '#official-player-frame.tw-pip-fullscreen-target:fullscreen{display:block!important;width:100vw!important;height:100vh!important;max-width:none!important;min-height:100vh!important;border:0!important;background:#000!important}',
    '.tw-pip-inline-shell{position:fixed;right:12px;bottom:calc(78px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;flex-direction:column;gap:5px;width:min(320px,calc(100vw - 24px));padding:7px;border:1px solid rgba(80,232,255,.35);border-radius:12px;background:#070a0e;box-shadow:0 10px 38px rgba(0,0,0,.55);}',
    '.tw-pip-inline-bar{height:25px;min-height:25px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:#dffaff;font:700 11px/1.2 system-ui,sans-serif;}',
    '.tw-pip-inline-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.tw-pip-inline-return{flex:0 0 auto;border:1px solid rgba(80,232,255,.35);border-radius:7px;background:#111d25;color:#dffaff;padding:5px 8px;font:700 10px/1 system-ui,sans-serif;cursor:pointer;}',
    '#official-player-frame.tw-pip-inline-video{display:block!important;width:100%!important;height:174px!important;min-height:0!important;max-width:none!important;border:0!important;border-radius:8px;background:#000!important;}',
    '@media(max-width:360px){#official-player-frame.tw-pip-inline-video{height:calc((100vw - 38px)*.5625)!important;}}'
  ].join('');
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'official-player-pip-button';
  button.textContent = canDocumentPiP ? '▣ Open mini-player (PiP)' : '▣ Open mini-player';
  button.setAttribute('aria-label', 'Try Picture-in-Picture for the YouTube song pasted into TuneWave');
  stage.insertBefore(button, frame);

  const help = document.createElement('p');
  help.className = 'official-player-pip-help';
  help.textContent = canDocumentPiP
    ? 'Opens a compact floating PiP window on supported desktop browsers.'
    : 'Opens a compact floating mini-player on this TuneWave page. It will not stay over other apps; true Android PiP depends on browser and YouTube support.';
  stage.insertBefore(help, frame);

  let pipWindow = null;
  let placeholder = null;
  let pipOriginalStyle = null;
  let pipOriginalTitle = null;
  let fullscreenOriginalStyle = null;
  let fullscreenMode = false;
  let inlineMiniShell = null;
  let inlineOriginalStyle = null;
  let inlineOriginalTitle = null;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  // Best-effort lock-screen / headset controls for the embedded YouTube iframe.
  // Browser and YouTube policy still decide whether playback may continue in the background.
  const mediaSession = navigator.mediaSession || null;
  const defaultArtwork = new URL('icon-512.png', document.baseURI).href;
  let youtubeSessionActive = false;
  let youtubeCurrentTime = 0;
  let youtubeDuration = 0;
  let youtubeVideoTitle = 'YouTube music';
  let youtubeVideoArtist = 'TuneWave';

  function sendYouTubeCommand(func, args = []) {
    if (!frame.contentWindow || !frame.getAttribute('src')) return;
    try {
      frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    } catch (_) {}
  }

  function setYouTubeMediaMetadata(title = youtubeVideoTitle, artist = youtubeVideoArtist, artwork = defaultArtwork) {
    youtubeVideoTitle = String(title || 'YouTube music');
    youtubeVideoArtist = String(artist || 'TuneWave');
    if (!mediaSession || typeof window.MediaMetadata !== 'function') return;
    try {
      mediaSession.metadata = new MediaMetadata({
        title: youtubeVideoTitle,
        artist: youtubeVideoArtist,
        album: 'TuneWave · YouTube',
        artwork: [96, 128, 192, 256, 512].map(size => ({ src: artwork || defaultArtwork, sizes: size + 'x' + size }))
      });
    } catch (_) {}
  }

  function setYouTubePlaybackState(state) {
    if (!mediaSession || !youtubeSessionActive) return;
    try { mediaSession.playbackState = state; } catch (_) {}
    if (youtubeDuration > 0 && typeof mediaSession.setPositionState === 'function') {
      try {
        mediaSession.setPositionState({
          duration: youtubeDuration,
          playbackRate: 1,
          position: Math.min(Math.max(0, youtubeCurrentTime), youtubeDuration)
        });
      } catch (_) {}
    }
  }

  function clearYouTubeMediaSession() {
    if (!youtubeSessionActive) return;
    youtubeSessionActive = false;
    if (mediaSession) {
      for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto']) {
        try { mediaSession.setActionHandler(action, null); } catch (_) {}
      }
      try { mediaSession.playbackState = 'none'; } catch (_) {}
      try { mediaSession.metadata = null; } catch (_) {}
    }
  }

  function activateYouTubeMediaSession() {
    const src = frame.getAttribute('src');
    if (!src) {
      clearYouTubeMediaSession();
      return;
    }
    let url;
    try { url = new URL(src, document.baseURI); } catch (_) { return; }
    if (!/(^|\\.)youtube(-nocookie)?\\.com$/i.test(url.hostname) || !url.pathname.includes('/embed/')) return;

    youtubeSessionActive = true;
    youtubeCurrentTime = 0;
    youtubeDuration = 0;
    setYouTubeMediaMetadata();

    if (mediaSession) {
      const handlers = {
        play: () => sendYouTubeCommand('playVideo'),
        pause: () => sendYouTubeCommand('pauseVideo'),
        previoustrack: () => sendYouTubeCommand('previousVideo'),
        nexttrack: () => sendYouTubeCommand('nextVideo'),
        seekbackward: details => sendYouTubeCommand('seekTo', [Math.max(0, youtubeCurrentTime - (details.seekOffset || 10)), true]),
        seekforward: details => sendYouTubeCommand('seekTo', [Math.min(youtubeDuration || youtubeCurrentTime + 10, youtubeCurrentTime + (details.seekOffset || 10)), true]),
        seekto: details => {
          if (Number.isFinite(details.seekTime)) sendYouTubeCommand('seekTo', [Math.max(0, details.seekTime), true]);
        }
      };
      for (const [action, handler] of Object.entries(handlers)) {
        try { mediaSession.setActionHandler(action, handler); } catch (_) {}
      }
      setYouTubePlaybackState('paused');
    }

    // Ask supported YouTube embeds to report playback state and timing.
    // Retrying briefly covers the iframe API becoming ready after its initial load.
    const subscribe = () => {
      if (!youtubeSessionActive || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'tunewave-youtube', channel: 'tunewave' }), '*');
      } catch (_) {}
      sendYouTubeCommand('addEventListener', ['onStateChange']);
      sendYouTubeCommand('addEventListener', ['onReady']);
      sendYouTubeCommand('addEventListener', ['onPlaybackQualityChange']);
      sendYouTubeCommand('getPlayerState');
      sendYouTubeCommand('getCurrentTime');
      sendYouTubeCommand('getDuration');
      sendYouTubeCommand('getVideoData');
    };
    [120, 500, 1300].forEach(delay => window.setTimeout(subscribe, delay));

    const videoId = url.pathname.split('/').filter(Boolean)[1] || '';
    if (videoId && videoId !== 'videoseries') {
      const target = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
      fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(target) + '&format=json')
        .then(response => response.ok ? response.json() : null)
        .then(data => {
          if (youtubeSessionActive && data) {
            setYouTubeMediaMetadata(data.title || youtubeVideoTitle, data.author_name || youtubeVideoArtist, data.thumbnail_url || defaultArtwork);
          }
        })
        .catch(() => {});
    }
  }

  window.addEventListener('message', event => {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    if (!/(^|\\.)youtube(-nocookie)?\\.com$/i.test(String(event.origin || '').replace(/^https:\\/\\//i, ''))) return;
    let payload = event.data;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) { return; }
    }
    if (!payload || typeof payload !== 'object') return;
    if (payload.event === 'infoDelivery' && payload.info && typeof payload.info === 'object') {
      const info = payload.info;
      if (Number.isFinite(Number(info.currentTime))) youtubeCurrentTime = Math.max(0, Number(info.currentTime));
      if (Number.isFinite(Number(info.duration)) && Number(info.duration) > 0) youtubeDuration = Number(info.duration);
      const video = info.videoData;
      if (video && (video.title || video.author)) setYouTubeMediaMetadata(video.title || youtubeVideoTitle, video.author || youtubeVideoArtist, video.video_id ? 'https://i.ytimg.com/vi/' + encodeURIComponent(video.video_id) + '/hqdefault.jpg' : defaultArtwork);
      if (Number(info.playerState) === 1) setYouTubePlaybackState('playing');
      else if ([0, 2, 5, -1].includes(Number(info.playerState))) setYouTubePlaybackState('paused');
      else if (Number.isFinite(Number(info.playerState))) setYouTubePlaybackState('playing');
      else setYouTubePlaybackState('playing');
    } else if (payload.event === 'onStateChange') {
      const stateValue = Number(payload.info);
      if (stateValue === 1) setYouTubePlaybackState('playing');
      else if ([0, 2, 5, -1].includes(stateValue)) setYouTubePlaybackState('paused');
    } else if (payload.event === 'onReady') {
      sendYouTubeCommand('getPlayerState');
      sendYouTubeCommand('getCurrentTime');
      sendYouTubeCommand('getDuration');
      sendYouTubeCommand('getVideoData');
    }
  });

  frame.addEventListener('load', () => {
    if (frame.getAttribute('src')) activateYouTubeMediaSession();
    else clearYouTubeMediaSession();
  });

  function restoreFullscreenStyle() {
    if (fullscreenOriginalStyle !== null) {
      if (fullscreenOriginalStyle === '') frame.removeAttribute('style');
      else frame.setAttribute('style', fullscreenOriginalStyle);
    }
    fullscreenOriginalStyle = null;
    frame.classList.remove('tw-pip-fullscreen-target');
    fullscreenMode = false;
    button.textContent = canDocumentPiP ? '▣ Open mini-player (PiP)' : '▣ Open mini-player';
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
    frame.classList.remove('tw-pip-video');
    if (pipWindow && !pipWindow.closed) {
      const oldWindow = pipWindow;
      pipWindow = null;
      try { oldWindow.close(); } catch (_) {}
    } else {
      pipWindow = null;
    }
    button.textContent = '▣ Open mini-player (PiP)';
  }

  function closePip() {
    if (document.fullscreenElement === frame && document.exitFullscreen) {
      try { document.exitFullscreen(); } catch (_) {}
    }
    if (fullscreenMode) restoreFullscreenStyle();
    if (inlineMiniShell) restoreInlineMiniPlayer();
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


  function restoreInlineMiniPlayer() {
    if (!inlineMiniShell) return;
    const shell = inlineMiniShell;
    inlineMiniShell = null;
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(frame, placeholder);
      placeholder.remove();
    }
    placeholder = null;
    if (inlineOriginalStyle === null) frame.removeAttribute('style');
    else frame.setAttribute('style', inlineOriginalStyle);
    inlineOriginalStyle = null;
    if (inlineOriginalTitle !== null) frame.title = inlineOriginalTitle;
    inlineOriginalTitle = null;
    frame.hidden = false;
    frame.classList.remove('tw-pip-inline-video');
    shell.remove();
    button.textContent = '▣ Open mini-player';
  }

  function openInlineMiniPlayer() {
    if (inlineMiniShell && inlineMiniShell.isConnected) return;

    const shell = document.createElement('section');
    shell.className = 'tw-pip-inline-shell';
    shell.setAttribute('aria-label', 'TuneWave floating mini-player');
    const bar = document.createElement('div');
    bar.className = 'tw-pip-inline-bar';
    const label = document.createElement('span');
    label.className = 'tw-pip-inline-label';
    label.textContent = 'TuneWave · Mini-player';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'tw-pip-inline-return';
    back.textContent = 'Return';
    back.setAttribute('aria-label', 'Return the YouTube player to TuneWave');
    bar.append(label, back);
    shell.appendChild(bar);

    placeholder = document.createComment('TuneWave mini-player placeholder');
    frame.parentNode.insertBefore(placeholder, frame);
    inlineOriginalStyle = frame.getAttribute('style');
    inlineOriginalTitle = frame.title;
    frame.title = 'TuneWave compact YouTube mini-player';
    frame.hidden = false;
    frame.classList.add('tw-pip-inline-video');

    document.body.appendChild(shell);
    shell.appendChild(frame);
    inlineMiniShell = shell;

    back.addEventListener('click', () => {
      restoreInlineMiniPlayer();
      setStatus('Returned the YouTube player to TuneWave.');
    });

    button.textContent = '▣ Mini-player is open';
    setStatus('Compact mini-player opened on this page. Tap Return to restore the YouTube player. It cannot float over other apps unless your browser provides system PiP.');
  }

  async function openDocumentPiP() {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.focus();
      return;
    }

    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 320, height: 220 });
    const pipDoc = pipWindow.document;
    pipDoc.documentElement.style.cssText = 'height:100%;margin:0;background:#070a0e;';
    pipDoc.body.style.cssText = 'height:100%;margin:0;overflow:hidden;background:#070a0e;color:#eaf8ff;font-family:system-ui,-apple-system,sans-serif;';
    const pipStyle = pipDoc.createElement('style');
    pipStyle.textContent = [
      '*{box-sizing:border-box}',
      '.tw-pip-shell{height:100%;display:flex;flex-direction:column;gap:4px;padding:6px;background:#070a0e}',
      '.tw-pip-bar{height:23px;min-height:23px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:#dffaff;font-size:10px;font-weight:700;letter-spacing:.02em}',
      '.tw-pip-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tw-pip-back{flex:0 0 auto;border:1px solid rgba(80,232,255,.35);border-radius:7px;background:#111d25;color:#dffaff;padding:4px 7px;font-size:9px;font-weight:700;cursor:pointer}',
      '.tw-pip-video{display:block;flex:1 1 auto;width:100%;height:calc(100% - 28px);min-height:0;border:0;border-radius:7px;background:#000}'
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
      button.textContent = '▣ Open mini-player (PiP)';
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
      else openInlineMiniPlayer();
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
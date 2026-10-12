// 카메라 영상 — 서버가 어떤 방식으로 영상을 주든 같은 자리에 띄웁니다 (대응표: docs/server-cases.md).
//   mjpeg    <img>에 MJPEG 주소를 건다 (multipart/x-mixed-replace). 가장 단순하고 기본값
//   snapshot JPEG 한 장씩 주는 주소를 정해진 간격으로 다시 받는다
//   ws       웹소켓으로 오는 JPEG 조각을 그린다. 주소가 없으면 주 연결의 frame 메시지를 기다린다
//   webrtc   WHEP 방식(SDP를 POST)으로 받는다 (MediaMTX·go2rtc·aiortc 등). 지연이 가장 짧다
//   video    <video>로 연다 (MP4·WebM 스트림, HLS는 브라우저가 직접 재생할 때만)
//   local    이 PC에 꽂힌 USB 카메라를 직접 연다. config.js cameras.local.upload가 있으면 서버로 올려 보낸다
//   mock     가짜 영상 (camera-sim.js)
// 서버가 판정 상자 좌표(bbox)를 보내면 영상 위에 겹쳐 그립니다.
(function () {
  const cfg = window.HMI_CONFIG;
  const { t } = window.I18N;
  const LOCAL_KEY = 'hmi.localCameras'; // tools/devices.html이 저장하는 { 카메라 id: 브라우저 장치 id }
  const COLORS = { good: '#46B07A', defect: '#F2B705', tagText: '#1C2024' };

  // 상대 주소는 서버 주소를 기준으로 푼다. 웹소켓이면 http → ws
  function resolveUrl(url, ws) {
    try {
      const u = new URL(url, ws ? cfg.wsUrl : cfg.apiBase.replace(/\/?$/, '/'));
      if (ws && /^http/.test(u.protocol)) u.protocol = u.protocol.replace('http', 'ws');
      return u.href;
    } catch (e) {
      return url;
    }
  }

  const bust = (url, key) => url + (url.includes('?') ? '&' : '?') + key + '=' + Date.now();

  function localDevice(id) {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}')[id] || null; } catch (e) { return null; }
  }

  // ICE 후보를 다 모을 때까지(최대 ms) 기다린다 — WHEP는 후보를 SDP에 담아 한 번에 보낸다
  function waitIce(pc, ms) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(done, ms);
    });
  }

  class CameraView {
    constructor(stage, options) {
      this.stage = stage;
      this.sim = options.sim || null;
      this.zoom = options.zoom || 1;
      this.labels = options.labels || { good: t('result.good'), defect: t('result.defect') };
      this.onState = options.onState || (() => {});
      this.current = null;
      this.state = 'off';
      this.boxes = [];
      this.frames = [];
      this.overlay = document.createElement('canvas');
      this.overlay.className = 'camera__overlay';
      this.overlay.hidden = true;
      this.status = document.createElement('p');
      this.status.className = 'camera__status';
      this.status.hidden = true;
      stage.append(this.overlay, this.status);
    }

    // source: store.cameraSource(id) — { id, streaming, url, transport, width, height } 또는 null
    set(source) {
      const want = source && source.streaming ? source : null;
      const key = want ? [want.transport, want.url || '', want.id].join('|') : '';
      if ((this.current ? this.current.key : '') === key) return;
      this.teardown();
      if (!want) { this.setState('off'); return; }
      const cur = { key, source: want, media: null, cleanup: [] };
      this.current = cur;
      this.setState('loading');
      const starts = {
        mock: this.startMock,
        mjpeg: this.startMjpeg,
        snapshot: this.startSnapshot,
        ws: this.startWs,
        webrtc: this.startWebrtc,
        video: this.startVideo,
        local: this.startLocal,
      };
      (starts[want.transport] || this.startMjpeg).call(this, want, cur);
    }

    setState(next, detail) {
      if (this.state === next && !detail) return;
      this.state = next;
      const text = next === 'loading' ? t('camera.waiting') : next === 'error' ? t(detail === 'no-url' ? 'camera.noUrl' : detail === 'local' ? 'camera.localFailed' : 'camera.failed') : '';
      this.status.textContent = text;
      this.status.hidden = !text;
      this.onState(next, detail);
    }

    teardown() {
      const cur = this.current;
      this.current = null;
      this.boxes = [];
      this.frames = [];
      this.overlay.hidden = true;
      if (!cur) return;
      cur.cleanup.forEach((fn) => { try { fn(); } catch (e) { /* 이미 닫힘 */ } });
      if (cur.media) cur.media.remove();
    }

    destroy() {
      this.teardown();
      this.overlay.remove();
      this.status.remove();
    }

    mount(cur, tag) {
      const el = document.createElement(tag);
      el.className = 'camera__media';
      if (tag === 'img') el.alt = '';
      if (tag === 'video') { el.muted = true; el.autoplay = true; el.playsInline = true; }
      this.stage.insertBefore(el, this.overlay);
      cur.media = el;
      return el;
    }

    frameTick() {
      const now = performance.now();
      this.frames.push(now);
      while (this.frames.length && now - this.frames[0] > 2000) this.frames.shift();
    }

    // 화면이 직접 받은 초당 장수 (snapshot·ws만 셀 수 있다). 모르면 null
    fps() {
      if (!this.current || !['snapshot', 'ws'].includes(this.current.source.transport) || this.frames.length < 2) return null;
      return Math.round((this.frames.length / 2) * 10) / 10;
    }

    startMock(src, cur) {
      const canvas = this.mount(cur, 'canvas');
      const view = this.sim.attach(canvas, { zoom: this.zoom });
      cur.cleanup.push(() => this.sim.detach(view));
      this.setState('live');
    }

    startMjpeg(src, cur) {
      if (!src.url) { this.setState('error', 'no-url'); return; }
      const img = this.mount(cur, 'img');
      const url = resolveUrl(src.url);
      let retry = 0;
      // MJPEG는 첫 장면이 오면 크기가 생긴다. 끊기면 3초 뒤 다시 연다
      const watch = setInterval(() => { if (img.naturalWidth > 0 && this.state !== 'live') this.setState('live'); }, 400);
      img.onerror = () => {
        if (this.current !== cur) return;
        this.setState('error');
        clearTimeout(retry);
        retry = setTimeout(() => { if (this.current === cur) img.src = bust(url, '_r'); }, 3000);
      };
      img.src = url;
      cur.cleanup.push(() => { clearInterval(watch); clearTimeout(retry); img.onerror = null; img.removeAttribute('src'); });
    }

    startSnapshot(src, cur) {
      if (!src.url) { this.setState('error', 'no-url'); return; }
      const img = this.mount(cur, 'img');
      const url = resolveUrl(src.url);
      const gap = 1000 / Math.max(0.2, cfg.cameras.snapshotFps || 5);
      let timer = 0;
      // 다음 장면은 보이지 않는 곳에서 다 받은 뒤 바꿔 끼워 깜빡이지 않게 한다
      const next = () => {
        if (this.current !== cur) return;
        const loader = new Image();
        loader.onload = () => {
          if (this.current !== cur) return;
          img.src = loader.src;
          this.setState('live');
          this.frameTick();
          timer = setTimeout(next, gap);
        };
        loader.onerror = () => {
          if (this.current !== cur) return;
          this.setState('error');
          timer = setTimeout(next, 2000);
        };
        loader.src = bust(url, '_t');
      };
      next();
      cur.cleanup.push(() => clearTimeout(timer));
    }

    startWs(src, cur) {
      this.mount(cur, 'img');
      if (!src.url) return; // 주 연결의 frame 메시지를 기다린다 (pushFrame)
      let ws = null;
      let retry = 0;
      let closed = false;
      const open = () => {
        ws = new WebSocket(resolveUrl(src.url, true));
        ws.binaryType = 'blob';
        ws.onopen = () => { retry = 0; };
        ws.onmessage = (e) => {
          if (typeof e.data === 'string') {
            let m;
            try { m = JSON.parse(e.data); } catch (err) { return; }
            const f = window.HmiApi.adapter.frame(m && m.data && typeof m.data === 'object' ? m.data : m);
            if (f) this.showFrame(cur, f);
            return;
          }
          this.showBlob(cur, e.data instanceof Blob ? e.data : new Blob([e.data], { type: 'image/jpeg' }));
        };
        ws.onclose = () => {
          if (closed || this.current !== cur) return;
          this.setState('error');
          setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
        };
      };
      open();
      cur.cleanup.push(() => {
        closed = true;
        if (ws) ws.close();
        if (cur.blobUrl) URL.revokeObjectURL(cur.blobUrl);
      });
    }

    showBlob(cur, blob) {
      if (this.current !== cur || !cur.media) return;
      const prev = cur.blobUrl;
      cur.blobUrl = URL.createObjectURL(blob);
      cur.media.src = cur.blobUrl;
      if (prev) URL.revokeObjectURL(prev); // 이미 그려진 장면은 주소를 거둬도 남는다
      this.setState('live');
      this.frameTick();
    }

    showFrame(cur, f) {
      if (this.current !== cur || !cur.media) return;
      if (f.url) cur.media.src = resolveUrl(f.url);
      else if (f.data) cur.media.src = 'data:' + f.mime + ';base64,' + f.data;
      else return;
      this.setState('live');
      this.frameTick();
    }

    // store가 받은 frame 메시지 (카메라 영상을 주 연결로 보내는 서버)
    pushFrame(frame) {
      const cur = this.current;
      if (!cur || cur.source.transport !== 'ws' || cur.source.url || frame.camera !== cur.source.id) return;
      this.showFrame(cur, frame);
    }

    async startWebrtc(src, cur) {
      if (!src.url) { this.setState('error', 'no-url'); return; }
      const video = this.mount(cur, 'video');
      const pc = new RTCPeerConnection({ iceServers: cfg.cameras.iceServers || [] });
      let resource = null;
      cur.cleanup.push(() => {
        pc.close();
        if (resource) fetch(resource, { method: 'DELETE', headers: cfg.server.headers }).catch(() => {});
      });
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.ontrack = (e) => {
        if (this.current !== cur) return;
        video.srcObject = e.streams[0] || new MediaStream([e.track]);
        video.play().catch(() => {});
        this.setState('live');
      };
      pc.onconnectionstatechange = () => {
        if (this.current === cur && ['failed', 'disconnected'].includes(pc.connectionState)) this.setState('error');
      };
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await waitIce(pc, 2000);
        const url = resolveUrl(src.url);
        const res = await fetch(url, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/sdp' }, cfg.server.headers),
          body: pc.localDescription.sdp,
        });
        if (!res.ok) throw new Error('WHEP ' + res.status);
        const loc = res.headers.get('Location'); // 다른 주소의 서버면 Access-Control-Expose-Headers: Location 필요
        if (loc) resource = new URL(loc, url).href;
        const answer = await res.text();
        if (this.current !== cur) return;
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch (err) {
        if (this.current === cur) this.setState('error');
      }
    }

    startVideo(src, cur) {
      if (!src.url) { this.setState('error', 'no-url'); return; }
      const video = this.mount(cur, 'video');
      video.onplaying = () => { if (this.current === cur) this.setState('live'); };
      video.onerror = () => { if (this.current === cur) this.setState('error'); };
      video.src = resolveUrl(src.url);
      video.play().catch(() => {});
      cur.cleanup.push(() => { video.onerror = null; video.removeAttribute('src'); video.load(); });
    }

    async startLocal(src, cur) {
      const video = this.mount(cur, 'video');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.setState('error', 'local'); return; }
      const deviceId = localDevice(src.id);
      const constraints = { width: { ideal: src.width || 1280 }, height: { ideal: src.height || 720 } };
      if (deviceId) constraints.deviceId = { exact: deviceId };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      } catch (err) {
        if (this.current === cur) this.setState('error', 'local');
        return;
      }
      if (this.current !== cur) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      video.srcObject = stream;
      video.play().catch(() => {});
      this.setState('live');
      cur.cleanup.push(() => stream.getTracks().forEach((tr) => tr.stop()));
      const up = cfg.cameras.local && cfg.cameras.local.upload;
      if (up) this.startUpload(cur, video, up.replace('{id}', encodeURIComponent(src.id)));
    }

    // 서버가 영상을 HMI 쪽에서 받아야 할 때: JPEG로 줄여 웹소켓으로 보낸다 (밀리면 그 장면은 건너뜀)
    startUpload(cur, video, url) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const opt = cfg.cameras.local;
      let ws = null;
      let closed = false;
      let busy = false;
      const open = () => {
        ws = new WebSocket(resolveUrl(url, true));
        ws.onclose = () => { if (!closed && this.current === cur) setTimeout(open, 2000); };
      };
      open();
      const timer = setInterval(() => {
        if (!ws || ws.readyState !== 1 || busy || !video.videoWidth || ws.bufferedAmount > 2e6) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        busy = true;
        canvas.toBlob((blob) => {
          busy = false;
          if (blob && ws.readyState === 1) ws.send(blob);
        }, 'image/jpeg', opt.quality || 0.8);
      }, 1000 / (opt.uploadFps || 10));
      cur.cleanup.push(() => { closed = true; clearInterval(timer); if (ws) ws.close(); });
    }

    // 판정 상자: 서버가 좌표(bbox)를 보낼 때 1.5초 동안 겹쳐 그린다. 가짜 영상은 스스로 그리므로 건너뛴다
    showInspection(item) {
      const cur = this.current;
      if (!cur || !cfg.cameras.overlay || !item || !item.bbox || cur.source.transport === 'mock') return;
      if (item.camera && item.camera !== cur.source.id) return;
      this.boxes.push({ bbox: item.bbox, result: item.result, until: performance.now() + 1500 });
      if (!this.overlayRaf) this.overlayRaf = requestAnimationFrame(() => this.drawOverlay());
    }

    drawOverlay() {
      this.overlayRaf = 0;
      const now = performance.now();
      this.boxes = this.boxes.filter((b) => b.until > now);
      const cur = this.current;
      const canvas = this.overlay;
      if (!cur || !cur.media || !this.boxes.length) { canvas.hidden = true; return; }
      const r = this.stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.hidden = false;
      if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      // object-fit: contain으로 그려진 영상의 실제 자리에 맞춘다
      const nw = cur.media.naturalWidth || cur.media.videoWidth || cur.source.width || 16;
      const nh = cur.media.naturalHeight || cur.media.videoHeight || cur.source.height || 9;
      const s = Math.min(r.width / nw, r.height / nh);
      const dw = nw * s;
      const dh = nh * s;
      const dx = (r.width - dw) / 2;
      const dy = (r.height - dh) / 2;
      ctx.font = '600 14px "IBM Plex Sans KR", "Malgun Gothic", sans-serif';
      ctx.textBaseline = 'middle';
      this.boxes.forEach((b) => {
        const color = b.result === 'defect' ? COLORS.defect : COLORS.good;
        const x = dx + b.bbox[0] * dw;
        const y = dy + b.bbox[1] * dh;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, b.bbox[2] * dw, b.bbox[3] * dh);
        const label = this.labels[b.result];
        if (!label) return;
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = color;
        ctx.fillRect(x - 1, y - 24, tw, 24);
        ctx.fillStyle = COLORS.tagText;
        ctx.fillText(label, x + 5, y - 12);
      });
      this.overlayRaf = requestAnimationFrame(() => this.drawOverlay());
    }
  }

  window.CameraView = CameraView;
  window.CameraView.LOCAL_KEY = LOCAL_KEY;
})();

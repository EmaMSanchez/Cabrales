import { DEFAULT_MARKS, SCENE_IDS, clamp, filmTime, originsCardEntry, readableStop, scenePose, validMarks } from '../lib/timeline.ts';

type Trigger = import('gsap/ScrollTrigger').ScrollTrigger;

function markList(raw?: string) {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    if (Array.isArray(parsed) && validMarks(parsed)) return parsed as number[];
  } catch { /* Without editorial timings, use the marks of the supplied master. */ }
  return [...DEFAULT_MARKS];
}

class CabralesJourney extends HTMLElement {
  #events?: AbortController;
  #trigger?: Trigger;
  #video!: HTMLVideoElement;
  #loop!: HTMLVideoElement;
  #loopSource = '';
  #loopActive = false;
  #loopFailed = false;
  #loopAttempt = 0;
  #stage!: HTMLElement;
  #productGrid?: HTMLUListElement;
  #scenes: HTMLElement[] = [];
  #portrait!: MediaQueryList;
  #reduced = matchMedia('(prefers-reduced-motion: reduce)');
  #short = matchMedia('(max-height: 540px), ((max-width: 360px) and (max-height: 610px))');
  #connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
  #marks: number[] = [...DEFAULT_MARKS];
  #active = -1;
  #progress = 0;
  #target = 0;
  #frame = 0;
  #timeout = 0;
  #generation = 0;
  #failed = false;

  connectedCallback() {
    if (this.#events) return;
    const video = this.querySelector<HTMLVideoElement>('.journey__video');
    const loop = this.querySelector<HTMLVideoElement>('.journey__loop');
    const stage = this.querySelector<HTMLElement>('.journey__stage');
    this.#scenes = [...this.querySelectorAll<HTMLElement>('[data-scene]')];
    if (!stage || !video || !loop || this.#scenes.length !== SCENE_IDS.length) return;
    this.#video = video;
    this.#loop = loop;
    this.#stage = stage;
    this.#productGrid = this.querySelector<HTMLUListElement>('.product-grid') ?? undefined;
    this.#portrait = matchMedia(this.dataset.portrait ?? '(max-aspect-ratio: 1/1)');

    const events = this.#events = new AbortController();
    const options = { signal: events.signal };
    this.#portrait.addEventListener('change', () => {
      if (this.#isMotion()) this.#selectSource();
    }, options);
    const updatePreference = () => this.#syncMode(true);
    this.#reduced.addEventListener('change', updatePreference, options);
    this.#short.addEventListener('change', updatePreference, options);
    this.#connection?.addEventListener('change', updatePreference, options);

    video.addEventListener('loadedmetadata', () => this.#syncVideo(this.#progress), options);
    video.addEventListener('loadeddata', () => this.#onDecoded(), options);
    video.addEventListener('seeked', () => this.#onDecoded(), options);
    video.addEventListener('error', () => { if (this.#isMotion()) this.#fallback(); }, options);
    loop.addEventListener('playing', () => {
      if (this.#loopActive) this.dataset.loopVisible = '';
    }, options);
    loop.addEventListener('error', () => {
      if (this.#isMotion() && loop.hasAttribute('src')) this.#disableLoop();
    }, options);
    document.addEventListener('visibilitychange', () => this.#syncLoop(), options);

    document.addEventListener('click', (event) => this.#onLink(event), options);
    window.addEventListener('hashchange', () => {
      requestAnimationFrame(() => {
        if (this.#isMotion() && location.hash) this.#jump(location.hash.slice(1), false);
      });
    }, options);
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        this.#trigger?.refresh();
        this.#render(this.#currentProgress());
      }
    }, options);
    this.#syncMode(false);
  }

  disconnectedCallback() {
    this.#events?.abort();
    this.#events = undefined;
    this.#stopMotion();
  }

  #available() {
    return !this.hasAttribute('data-editor') && !this.#reduced.matches && !this.#short.matches &&
      !this.#connection?.saveData && !this.#failed;
  }

  #isMotion() { return this.dataset.mode === 'motion'; }

  #syncMode(align: boolean) {
    const shouldAnimate = this.#available();
    if (shouldAnimate && !this.#isMotion()) {
      const current = align ? this.#chapterInView() : undefined;
      void this.#startMotion(current);
    } else if (!shouldAnimate && this.#isMotion()) {
      const current = this.#active;
      const inJourney = this.getBoundingClientRect().bottom > 0;
      this.#stopMotion();
      if (align && inJourney && current >= 0) this.#scenes[current].scrollIntoView({ block: 'start', behavior: 'auto' });
    } else if (!this.dataset.mode) {
      this.dataset.mode = 'static';
    }
  }

  async #startMotion(current?: number) {
    const generation = ++this.#generation;
    this.dataset.mode = 'motion';
    if (current !== undefined && current >= 0) this.#scrollToScene(current);
    else if (location.hash) this.#jump(location.hash.slice(1), false);
    this.#render(this.#currentProgress());
    this.#selectSource();
    if (!this.#isMotion()) return;

    try {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
      if (generation !== this.#generation || !this.isConnected) return;
      gsap.registerPlugin(ScrollTrigger);
      ScrollTrigger.config({ ignoreMobileResize: true });
      this.#trigger = ScrollTrigger.create({
        trigger: this,
        start: 'top top',
        end: () => `+=${this.#distance()}`,
        invalidateOnRefresh: true,
        onUpdate: ({ progress }) => this.#render(progress),
        onRefresh: ({ progress }) => this.#render(progress),
      });
      this.#render(this.#trigger.progress);
    } catch {
      if (generation === this.#generation) this.#fallback();
    }
  }

  #stopMotion() {
    ++this.#generation;
    this.#trigger?.kill();
    this.#trigger = undefined;
    this.dataset.mode = 'static';
    delete this.dataset.frameReady;
    delete this.dataset.chapter;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    clearTimeout(this.#timeout);
    this.#timeout = 0;
    this.#resetLoop();
    if (this.#video?.hasAttribute('src')) {
      this.#video.removeAttribute('src');
      this.#video.preload = 'none';
      this.#video.load();
    }
    for (const panel of this.#scenes) {
      panel.inert = false;
      panel.removeAttribute('aria-hidden');
      delete panel.dataset.active;
    }
    if (this.#productGrid) this.#productGrid.inert = false;
  }

  #fallback() {
    this.#failed = true;
    this.#syncMode(true);
  }

  #selectSource() {
    const key = this.#portrait.matches ? 'mobile' : 'desktop';
    this.#marks = markList(this.dataset[key === 'mobile' ? 'mobileMarks' : 'desktopMarks']);
    const source = this.dataset[key];
    if (!source || !this.#video.canPlayType('video/mp4')) { this.#fallback(); return; }
    const loop = this.dataset[key === 'mobile' ? 'mobileLoop' : 'desktopLoop'] ?? '';
    if (loop !== this.#loopSource) this.#resetLoop(loop);
    if (this.#video.getAttribute('src') !== source) {
      delete this.dataset.frameReady;
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      clearTimeout(this.#timeout);
      this.#timeout = 0;
      this.#video.preload = loop && this.#progress === 0 ? 'metadata' : 'auto';
      this.#video.src = source;
      this.#video.load();
    }
    this.#syncLoop();
    this.#syncVideo(this.#progress);
  }

  #resetLoop(source = '') {
    ++this.#loopAttempt;
    this.#loopSource = source;
    this.#loopFailed = false;
    this.#loopActive = false;
    delete this.dataset.loopVisible;
    if (this.#loop?.hasAttribute('src')) {
      this.#loop.pause();
      this.#loop.removeAttribute('src');
      this.#loop.load();
    }
  }

  #disableLoop() {
    this.#loopFailed = true;
    delete this.dataset.loopVisible;
    this.#syncLoop();
  }

  #syncLoop() {
    if (!this.#isMotion()) return;
    const atTop = this.#progress === 0;
    const available = Boolean(this.#loopSource) && !this.#loopFailed;
    const play = atTop && available && !document.hidden;
    if (play !== this.#loopActive) {
      this.#loopActive = play;
      const attempt = ++this.#loopAttempt;
      if (play) {
        if (!this.#loop.hasAttribute('src')) this.#loop.src = this.#loopSource;
        else if (this.#loop.readyState >= 1 && !this.hasAttribute('data-loop-visible')) this.#loop.currentTime = 0;
        void this.#loop.play().catch(() => {
          if (this.#loopAttempt === attempt) this.#disableLoop();
        });
      } else {
        // Hold the last painted loop frame until the scroll clip has decoded its target.
        this.#loop.pause();
      }
    }
    if (!atTop || !available) this.#requireFilm();
    else if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = 0;
    }
  }

  #requireFilm() {
    if (!this.#video.hasAttribute('src')) return;
    if (this.#video.preload !== 'auto') this.#video.preload = 'auto';
    if (!this.#timeout && !this.hasAttribute('data-frame-ready')) {
      this.#timeout = window.setTimeout(() => {
        if (!this.hasAttribute('data-frame-ready')) this.#fallback();
      }, 14000);
    }
  }

  #render(progress: number) {
    if (!this.#isMotion()) return;
    this.#progress = progress;
    const pose = scenePose(progress);
    if (this.#active !== pose.index || !this.dataset.chapter) {
      this.#active = pose.index;
      this.dataset.chapter = SCENE_IDS[pose.index];
      for (const [index, panel] of this.#scenes.entries()) {
        const active = index === pose.index;
        panel.toggleAttribute('data-active', active);
        panel.inert = !active;
        if (active) panel.removeAttribute('aria-hidden');
        else panel.setAttribute('aria-hidden', 'true');
      }
    }
    const active = this.#scenes[pose.index];
    active.style.setProperty('--scene-alpha', pose.opacity.toFixed(3));
    active.style.setProperty('--scene-shift', `${pose.offset.toFixed(2)}px`);
    this.#stage.style.setProperty('--film-blur', `${pose.blur.toFixed(2)}px`);
    this.#stage.style.setProperty('--film-scale', String(1 + pose.blur / 360));
    if (pose.index === 3) {
      const count = active.querySelectorAll('.scene__word').length;
      active.style.setProperty('--words', String(clamp((progress - .657) / .063) * (count + .65)));
      if (this.#productGrid) {
        const entry = originsCardEntry(progress);
        this.#productGrid.style.setProperty('--cards-entry', entry.toFixed(4));
        // Keep links out of pointer and keyboard navigation until the cards are readable.
        this.#productGrid.inert = entry < .8;
      }
    }
    this.#syncLoop();
    this.#syncVideo(progress);
  }

  #syncVideo(progress: number) {
    if (!this.#isMotion() || !Number.isFinite(this.#video.duration)) return;
    this.#target = filmTime(progress, this.#video.duration, this.#marks);
    if (!this.#frame && !this.#video.seeking) {
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        if (!this.#isMotion() || this.#video.seeking) return;
        if (Math.abs(this.#video.currentTime - this.#target) > 1 / 48) {
          try { this.#video.currentTime = this.#target; } catch { /* Metadata is still being initialized. */ }
        } else {
          this.#showFrame();
        }
      });
    }
  }

  #onDecoded() {
    if (!this.#isMotion()) return;
    this.#showFrame();
    if (Math.abs(this.#video.currentTime - this.#target) > 1 / 48) this.#syncVideo(this.#progress);
  }

  #showFrame() {
    if (this.#video.readyState < 2 || this.#video.seeking || Math.abs(this.#video.currentTime - this.#target) >= .09) return;
    if (!this.hasAttribute('data-frame-ready')) {
      clearTimeout(this.#timeout);
      this.#timeout = 0;
      this.dataset.frameReady = '';
    }
    if (this.#progress > 0) delete this.dataset.loopVisible;
  }

  #distance() { return Math.max(1, this.offsetHeight - this.#stage.offsetHeight); }

  #currentProgress() { return clamp(-this.getBoundingClientRect().top / this.#distance()); }

  #chapterInView() {
    if (this.#isMotion()) return this.#active;
    const line = Math.min(innerHeight * .27, 150);
    const index = this.#scenes.findIndex((panel) => panel.getBoundingClientRect().bottom > line);
    return index >= 0 ? index : SCENE_IDS.length - 1;
  }

  #scrollToScene(index: number) {
    const progress = readableStop(index);
    const top = window.scrollY + this.getBoundingClientRect().top;
    window.scrollTo({ top: Math.round(top + this.#distance() * progress), behavior: 'auto' });
    this.#render(progress);
  }

  #focus(node: HTMLElement) {
    (node.querySelector<HTMLElement>('.scene__heading') ?? node).focus({ preventScroll: true });
  }

  #jump(id: string, focus: boolean) {
    const index = this.#scenes.findIndex((panel) => panel.id === id);
    const destination = document.getElementById(id);
    if (index !== -1 && this.#isMotion()) this.#scrollToScene(index);
    else destination?.scrollIntoView({ block: 'start', behavior: 'auto' });
    if (focus && destination) this.#focus(destination);
  }

  #onLink(event: MouseEvent) {
    if (!this.#isMotion() || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
    const hash = link?.getAttribute('href');
    if (!link || !hash || !/^#[a-z][\w-]*$/.test(hash) || !document.getElementById(hash.slice(1))) return;
    event.preventDefault();
    if (location.hash !== hash) history.pushState(null, '', hash);
    this.#jump(hash.slice(1), event.detail === 0);
  }
}

if (!customElements.get('cabrales-journey')) customElements.define('cabrales-journey', CabralesJourney);

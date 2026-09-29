// A short celebratory banner over the map for legends and wonders.
// Messages queue so a burst (e.g. a restored save) shows one at a time.
export const BANNER_MS = 3600;

export class Banner {
  constructor(host, i18n, { reducedMotion = () => false } = {}) {
    this.i18n = i18n;
    this.reducedMotion = reducedMotion;
    this.queue = [];
    this.timer = null;
    this.node = null;
    if (!host) return;
    this.node = document.createElement('p');
    this.node.className = 'divine-banner';
    this.node.setAttribute('role', 'status');
    this.node.setAttribute('aria-live', 'polite');
    this.node.hidden = true;
    host.append(this.node);
  }

  show(event) {
    if (!this.node) return;
    this.queue.push(event);
    if (this.queue.length > 6) this.queue.shift();
    if (!this.timer) this.next();
  }

  next() {
    const event = this.queue.shift();
    if (!event) { this.node.hidden = true; this.timer = null; return; }
    this.node.textContent = this.i18n.formatMessage(event);
    this.node.dataset.kind = event.action === 'wonder' ? 'wonder' : 'legend';
    this.node.classList.toggle('animated', !this.reducedMotion());
    this.node.hidden = false;
    // Restart the CSS entrance animation for consecutive banners.
    this.node.style.animation = 'none'; void this.node.offsetWidth; this.node.style.animation = '';
    this.timer = setTimeout(() => this.next(), BANNER_MS);
  }

  dispose() { clearTimeout(this.timer); this.node?.remove(); this.queue = []; }
}

// Bounded FIFO. The frame loop never awaits this queue. Timeout/stop settle
// callers even when a provider ignores cancellation; late replies are discarded.
export class RequestQueue {
  constructor({ timeoutMs = 30000, capacity = 8 } = {}) {
    this.timeoutMs = timeoutMs;
    this.capacity = capacity;
    this.waiting = [];
    this.active = null;
    this.closed = false;
  }

  enqueue(task) {
    if (this.closed || this.waiting.length + Number(!!this.active) >= this.capacity) {
      return Promise.reject(new Error(this.closed ? 'queue_closed' : 'queue_full'));
    }
    return new Promise((resolve, reject) => {
      this.waiting.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    if (this.closed || this.active || !this.waiting.length) return;
    const job = this.waiting.shift();
    const controller = new AbortController();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.active = null;
      if (error) controller.abort();
      if (error) job.reject(error); else job.resolve(value);
      this.drain();
    };
    const timer = setTimeout(() => finish(new Error('request_timeout')), this.timeoutMs);
    this.active = { cancel: () => finish(new Error('queue_closed')) };
    try {
      Promise.resolve(job.task(controller.signal)).then(value => finish(null, value), error => finish(error));
    } catch (error) { finish(error); }
  }

  stop() {
    this.closed = true;
    for (const job of this.waiting.splice(0)) job.reject(new Error('queue_closed'));
    this.active?.cancel();
  }
}

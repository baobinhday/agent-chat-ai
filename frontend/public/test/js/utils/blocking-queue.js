export default class BlockingQueue {
    #items = [];
    #waiters = [];          // {resolve, reject, min, timer, onTimeout}

    /* Empty queue one-time gate */
    #emptyPromise = null;
    #emptyResolve = null;

    /* Producer: put data in */
    enqueue(item, ...restItems) {
        if (restItems.length === 0) {
            this.#items.push(item);
        }
        // If there are extra arguments, process all items in batch
        else {
            const items = [item, ...restItems].filter(i => i);
            if (items.length === 0) return;
            this.#items.push(...items);
        }
        // If there is an empty queue gate, release all waiters at once
        if (this.#emptyResolve) {
            this.#emptyResolve();
            this.#emptyResolve = null;
            this.#emptyPromise = null;
        }

        // Wake up all waiters
        this.#wakeWaiters();
    }

    /* Consumer: wait for min items or timeout ms, whichever comes first */
    async dequeue(min = 1, timeout = Infinity, onTimeout = null) {
        // 1. If empty, wait for first data arrival (all calls share the same promise)
        if (this.#items.length === 0) {
            await this.#waitForFirstItem();
        }

        // Satisfied immediately
        if (this.#items.length >= min) {
            return this.#flush();
        }

        // Need to wait
        return new Promise((resolve, reject) => {
            let timer = null;
            const waiter = { resolve, reject, min, onTimeout, timer };

            // Timeout logic
            if (Number.isFinite(timeout)) {
                waiter.timer = setTimeout(() => {
                    this.#removeWaiter(waiter);
                    if (onTimeout) onTimeout(this.#items.length);
                    resolve(this.#flush());
                }, timeout);
            }

            this.#waiters.push(waiter);
        });
    }

    /* Empty queue gate generator */
    #waitForFirstItem() {
        if (!this.#emptyPromise) {
            this.#emptyPromise = new Promise(r => (this.#emptyResolve = r));
        }
        return this.#emptyPromise;
    }

    /* Internal: check which waiters are satisfied after each data change */
    #wakeWaiters() {
        for (let i = this.#waiters.length - 1; i >= 0; i--) {
            const w = this.#waiters[i];
            if (this.#items.length >= w.min) {
                this.#removeWaiter(w);
                w.resolve(this.#flush());
            }
        }
    }

    #removeWaiter(waiter) {
        const idx = this.#waiters.indexOf(waiter);
        if (idx !== -1) {
            this.#waiters.splice(idx, 1);
            if (waiter.timer) clearTimeout(waiter.timer);
        }
    }

    #flush() {
        const snapshot = [...this.#items];
        this.#items.length = 0;
        return snapshot;
    }

    /* Current buffer length (excluding waiters) */
    get length() {
        return this.#items.length;
    }

    /* Clear queue (keep object reference, does not affect waiters) */
    clear() {
        this.#items.length = 0;
    }
}
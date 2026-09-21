/**
 * Small FIFO mutex shared by the kernel and frontend persistence adapters.
 */
export class Mutex {
    private queue: (() => void)[] = [];
    private locked = false;
    private acquiredCount = 0;

    acquire(): { promise: Promise<{ release: () => void }>; cancel: () => void } {
        if (!this.locked) {
            this.locked = true;
            this.acquiredCount++;
            return {
                promise: Promise.resolve({ release: () => this.release() }),
                cancel: () => {},
            };
        }

        let queuedFn: (() => void) | null = null;
        const promise = new Promise<{ release: () => void }>((resolve) => {
            queuedFn = () => {
                this.acquiredCount++;
                resolve({ release: () => this.release() });
            };
            this.queue.push(queuedFn);
        });
        return {
            promise,
            cancel: () => {
                if (!queuedFn) return;
                const index = this.queue.indexOf(queuedFn);
                if (index >= 0) this.queue.splice(index, 1);
                queuedFn = null;
            },
        };
    }

    release(): void {
        if (this.acquiredCount > 0) this.acquiredCount--;
        if (this.acquiredCount > 0) return;
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.locked = false;
        }
    }
}

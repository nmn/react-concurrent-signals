export class Emitter<T extends unknown[]> {
  private listeners = new Set<(...args: T) => void>();

  subscribe(listener: (...args: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(...args: T): void {
    for (const listener of Array.from(this.listeners)) {
      listener(...args);
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

export type Listener<T> = (event: T) => void;

export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  /** Subscribe; returns an unsubscribe function. */
  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: T): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

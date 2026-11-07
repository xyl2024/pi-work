export interface EscapeLayerStack {
  push(id: string): () => void;
  pop(id: string): void;
  active(): string | null;
}

export function createEscapeLayerStack(): EscapeLayerStack {
  const layers: string[] = [];

  const pop = (id: string) => {
    const index = layers.lastIndexOf(id);
    if (index >= 0) layers.splice(index, 1);
  };

  return {
    push(id) {
      layers.push(id);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pop(id);
      };
    },
    pop,
    active() {
      return layers.length > 0 ? layers[layers.length - 1] : null;
    },
  };
}

export const escapeLayers = createEscapeLayerStack();

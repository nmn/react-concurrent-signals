const RADIX_SIZE = 32;

const radixPowers = Array.from(
  { length: 12 },
  (_, depth) => RADIX_SIZE ** depth,
);

type Owner = object;

type TrieNode<Key extends object, Value> = {
  owner: Owner;
  children: (
    | TrieNode<Key, Value>
    | PersistentValueEntry<Key, Value>
    | undefined
  )[];
};

type OrderNode<Key extends object> = {
  readonly id: number;
  readonly key: Key;
  readonly previous: OrderNode<Key> | undefined;
};

export type PersistentValueEntry<Key extends object, Value> = {
  readonly id: number;
  readonly key: Key;
  readonly value: Value;
};

export interface PersistentValuesDraft<Key extends object, Value> {
  getEntry(id: number): PersistentValueEntry<Key, Value> | undefined;
  setEntry(
    entry: PersistentValueEntry<Key, Value>,
  ): PersistentValueEntry<Key, Value>;
  finish(): PersistentValues<Key, Value>;
}

const getDepth = (id: number) => {
  let depth = 0;
  while (id >= radixPowers[depth + 1]) {
    ++depth;
  }
  return depth;
};

const getSlot = (id: number, depth: number) =>
  Math.floor(id / radixPowers[depth]) % RADIX_SIZE;

const getEntry = <Key extends object, Value>(
  root: TrieNode<Key, Value> | undefined,
  depth: number,
  id: number,
): PersistentValueEntry<Key, Value> | undefined => {
  if (
    !root ||
    id >= radixPowers[depth + 1]
  ) {
    return undefined;
  }

  let node = root;
  for (let level = depth; level > 0; --level) {
    const child = node.children[getSlot(id, level)] as
      | TrieNode<Key, Value>
      | undefined;
    if (!child) {
      return undefined;
    }
    node = child;
  }
  return node.children[getSlot(id, 0)] as
    | PersistentValueEntry<Key, Value>
    | undefined;
};

const createNode = <Key extends object, Value>(
  owner: Owner,
): TrieNode<Key, Value> => ({
  owner,
  children: [],
});

const getEditableNode = <Key extends object, Value>(
  node: TrieNode<Key, Value> | undefined,
  owner: Owner,
): TrieNode<Key, Value> => {
  if (node?.owner === owner) {
    return node;
  }
  return {
    owner,
    children: node ? node.children.slice() : [],
  };
};

const setEntry = <Key extends object, Value>(
  root: TrieNode<Key, Value> | undefined,
  depth: number,
  id: number,
  entry: PersistentValueEntry<Key, Value>,
  owner: Owner,
): {
  readonly root: TrieNode<Key, Value>;
  readonly depth: number;
} => {
  const targetDepth = getDepth(id);
  let nextRoot = root;
  let nextDepth = depth;

  if (!nextRoot) {
    nextDepth = targetDepth;
  } else {
    while (nextDepth < targetDepth) {
      const parent = createNode<Key, Value>(owner);
      parent.children[0] = nextRoot;
      nextRoot = parent;
      ++nextDepth;
    }
  }

  nextRoot = getEditableNode(nextRoot, owner);
  let node = nextRoot;
  for (let level = nextDepth; level > 0; --level) {
    const slot = getSlot(id, level);
    const child = getEditableNode(
      node.children[slot] as TrieNode<Key, Value> | undefined,
      owner,
    );
    node.children[slot] = child;
    node = child;
  }
  node.children[getSlot(id, 0)] = entry;

  return { root: nextRoot, depth: nextDepth };
};

export class PersistentValues<Key extends object, Value> {
  constructor(
    private readonly root: TrieNode<Key, Value> | undefined,
    private readonly depth: number,
    readonly size: number,
    private readonly orderTail: OrderNode<Key> | undefined,
  ) {}

  static empty<Key extends object, Value = unknown>(): PersistentValues<
    Key,
    Value
  > {
    return new PersistentValues<Key, Value>(
      undefined,
      0,
      0,
      undefined,
    );
  }

  getEntry(id: number): PersistentValueEntry<Key, Value> | undefined {
    return getEntry(this.root, this.depth, id);
  }

  set(id: number, key: Key, value: Value): PersistentValues<Key, Value> {
    const entry: PersistentValueEntry<Key, Value> = { id, key, value };
    const previous = getEntry(this.root, this.depth, id);
    const nextOrder = previous
      ? this.orderTail
      : { id, key, previous: this.orderTail };
    const owner = {};
    const next = setEntry(
      this.root,
      this.depth,
      id,
      entry,
      owner,
    );
    return new PersistentValues(
      next.root,
      next.depth,
      previous ? this.size : this.size + 1,
      nextOrder,
    );
  }

  draft(): PersistentValuesDraft<Key, Value> {
    return new PersistentValuesDraftImpl(
      this,
      this.root,
      this.depth,
      this.size,
      this.orderTail,
    );
  }

  toMap(): Map<Key, Value> {
    const values = new Map<Key, Value>();
    const order = new Array<OrderNode<Key>>(this.size);
    let orderNode = this.orderTail;
    for (let index = this.size - 1; index >= 0; --index) {
      order[index] = orderNode as OrderNode<Key>;
      orderNode = orderNode?.previous;
    }
    for (const item of order) {
      const entry = getEntry(this.root, this.depth, item.id);
      if (entry) {
        values.set(entry.key, entry.value);
      }
    }
    return values;
  }
}

class PersistentValuesDraftImpl<Key extends object, Value>
  implements PersistentValuesDraft<Key, Value>
{
  private readonly owner = {};
  private changed = false;
  private finished = false;

  constructor(
    private readonly base: PersistentValues<Key, Value>,
    private root: TrieNode<Key, Value> | undefined,
    private depth: number,
    private currentSize: number,
    private orderTail: OrderNode<Key> | undefined,
  ) {}

  getEntry(id: number): PersistentValueEntry<Key, Value> | undefined {
    return getEntry(this.root, this.depth, id);
  }

  setEntry(
    entry: PersistentValueEntry<Key, Value>,
  ): PersistentValueEntry<Key, Value> {
    this.assertOpen();
    const { id, key } = entry;
    const previous = getEntry(this.root, this.depth, id);
    const next = setEntry(
      this.root,
      this.depth,
      id,
      entry,
      this.owner,
    );
    this.root = next.root;
    this.depth = next.depth;
    if (!previous) {
      ++this.currentSize;
      this.orderTail = {
        id,
        key,
        previous: this.orderTail,
      };
    }
    this.changed = true;
    return entry;
  }

  finish(): PersistentValues<Key, Value> {
    this.assertOpen();
    this.finished = true;
    return this.changed
      ? new PersistentValues(
          this.root,
          this.depth,
          this.currentSize,
          this.orderTail,
        )
      : this.base;
  }

  private assertOpen() {
    if (this.finished) {
      throw Error("already finished");
    }
  }
}

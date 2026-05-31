export interface ThreadSummaryPlacementInput {
  desiredTop: number;
  rowHalf: number;
}

export interface ThreadSummaryPlacementOutput {
  top: number;
}

export function normalizeWheelDelta(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}

interface Block<T extends ThreadSummaryPlacementInput> {
  entries: Array<{ placement: T; offset: number }>;
  base: number;
}

export function computeThreadSummaryLayout<T extends ThreadSummaryPlacementInput>(
  placements: T[],
  gap = 8,
): Array<T & ThreadSummaryPlacementOutput> {
  const sorted = [...placements].sort((a, b) => a.desiredTop - b.desiredTop);
  const blocks: Array<Block<T>> = [];

  const recomputeBase = (entries: Block<T>["entries"]) =>
    entries.reduce((sum, entry) => sum + entry.placement.desiredTop - entry.offset, 0) / entries.length;
  const blockStart = (block: Block<T>) => {
    const first = block.entries[0]!;
    return block.base + first.offset - first.placement.rowHalf;
  };
  const blockEnd = (block: Block<T>) => {
    const last = block.entries[block.entries.length - 1]!;
    return block.base + last.offset + last.placement.rowHalf;
  };
  const mergeBlocks = (left: Block<T>, right: Block<T>): Block<T> => {
    const entries: Block<T>["entries"] = [];
    let offset = 0;
    for (let index = 0; index < left.entries.length; index += 1) {
      const entry = left.entries[index]!;
      entries.push({ placement: entry.placement, offset });
      offset += entry.placement.rowHalf;
      const next = left.entries[index + 1];
      if (next) offset += next.placement.rowHalf + gap;
    }

    const lastLeft = entries[entries.length - 1]!;
    offset = lastLeft.offset + lastLeft.placement.rowHalf + gap;
    for (const entry of right.entries) {
      offset += entry.placement.rowHalf;
      entries.push({ placement: entry.placement, offset });
      offset += entry.placement.rowHalf + gap;
    }

    return { entries, base: recomputeBase(entries) };
  };

  for (const placement of sorted) {
    blocks.push({ entries: [{ placement, offset: 0 }], base: placement.desiredTop });
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1]!;
      const left = blocks[blocks.length - 2]!;
      if (blockEnd(left) + gap <= blockStart(right)) break;
      blocks.splice(blocks.length - 2, 2, mergeBlocks(left, right));
    }
  }

  return blocks.flatMap((block) =>
    block.entries.map((entry) => ({
      ...entry.placement,
      top: block.base + entry.offset,
    })),
  );
}

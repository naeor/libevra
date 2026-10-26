/**
 * 测试专用确定性伪随机数生成器（mulberry32）。
 *
 * 只允许测试代码导入：生产布局代码不得依赖随机数/时钟（投影必须是确定性的，
 * 同一输入永远得到同一输出）。属性测试用固定种子生成可复现的场景。
 */
export interface TestPrng {
  /** 规范化后的 32 位无符号种子，便于测试报告复现。 */
  readonly seed: number;
  /** [0, 1) 的浮点数。 */
  nextFloat(): number;
  /** [minInclusive, maxInclusive] 的整数。 */
  nextInt(minInclusive: number, maxInclusive: number): number;
  /** 以 probability 概率返回 true。 */
  chance(probability: number): boolean;
  /** 从非空数组中等概率取一个元素。 */
  pick<T>(items: readonly T[]): T;
  /** 返回打乱后的新数组（不修改输入）。 */
  shuffle<T>(items: readonly T[]): readonly T[];
}

export function createTestPrng(seed: number): TestPrng {
  const normalizedSeed = Math.trunc(seed) >>> 0;
  let state = normalizedSeed;

  const nextFloat = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (minInclusive: number, maxInclusive: number): number => {
    if (
      !Number.isInteger(minInclusive) ||
      !Number.isInteger(maxInclusive) ||
      maxInclusive < minInclusive
    ) {
      throw new RangeError("nextInt 需要整数范围且 maxInclusive >= minInclusive");
    }
    const width = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(nextFloat() * width);
  };

  const chance = (probability: number): boolean => nextFloat() < probability;

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new RangeError("pick 不能用于空数组");
    }
    return items[Math.floor(nextFloat() * items.length)] as T;
  };

  const shuffle = <T>(items: readonly T[]): readonly T[] => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = nextInt(0, index);
      const value = copy[index] as T;
      copy[index] = copy[swapIndex] as T;
      copy[swapIndex] = value;
    }
    return copy;
  };

  return { seed: normalizedSeed, nextFloat, nextInt, chance, pick, shuffle };
}

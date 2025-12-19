/**
 * Profiler Utility
 * Performance measurement for analysis operations
 */

export interface ProfileMark {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export class Profiler {
  private marks: Map<string, ProfileMark> = new Map();
  private enabled: boolean = true;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  /**
   * Start a profiling mark
   */
  start(name: string, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;

    this.marks.set(name, {
      name,
      startTime: performance.now(),
      metadata,
    });
  }

  /**
   * End a profiling mark and return duration
   */
  end(name: string): number {
    if (!this.enabled) return 0;

    const mark = this.marks.get(name);
    if (!mark) {
      console.warn(`Profiler: No start mark found for "${name}"`);
      return 0;
    }

    mark.endTime = performance.now();
    mark.duration = mark.endTime - mark.startTime;
    return mark.duration;
  }

  /**
   * Measure an async operation
   */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }

  /**
   * Measure a sync operation
   */
  measureSync<T>(name: string, fn: () => T): T {
    this.start(name);
    try {
      return fn();
    } finally {
      this.end(name);
    }
  }

  /**
   * Get duration of a completed mark
   */
  getDuration(name: string): number | undefined {
    return this.marks.get(name)?.duration;
  }

  /**
   * Get all completed marks
   */
  getMarks(): ProfileMark[] {
    return Array.from(this.marks.values()).filter(m => m.duration !== undefined);
  }

  /**
   * Get a summary of all marks
   */
  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const mark of this.marks.values()) {
      if (mark.duration !== undefined) {
        summary[mark.name] = Math.round(mark.duration);
      }
    }
    return summary;
  }

  /**
   * Clear all marks
   */
  clear(): void {
    this.marks.clear();
  }

  /**
   * Log summary to console
   */
  logSummary(): void {
    if (!this.enabled) return;

    console.log('[TypeMap Profiler] Summary:');
    for (const [name, mark] of this.marks) {
      if (mark.duration !== undefined) {
        console.log(`  ${name}: ${mark.duration.toFixed(2)}ms`);
      }
    }
  }
}

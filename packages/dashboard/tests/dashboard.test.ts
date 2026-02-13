import { describe, it, expect } from 'vitest';
import { cn, formatDate, formatDuration, formatBytes } from '../src/lib/utils';

describe('Utility Functions', () => {
  describe('cn', () => {
    it('should merge class names', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('should handle conditional classes', () => {
      expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
    });

    it('should merge tailwind classes correctly', () => {
      expect(cn('px-2', 'px-4')).toBe('px-4');
    });
  });

  describe('formatDate', () => {
    it('should format a date string', () => {
      const date = '2024-01-15T10:30:00Z';
      const result = formatDate(date);
      expect(result).toContain('Jan');
      expect(result).toContain('15');
      expect(result).toContain('2024');
    });

    it('should format a Date object', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const result = formatDate(date);
      expect(result).toContain('Jan');
      expect(result).toContain('15');
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(2500)).toBe('2.5s');
    });

    it('should format minutes', () => {
      expect(formatDuration(90000)).toBe('1.5m');
    });
  });

  describe('formatBytes', () => {
    it('should format zero bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
    });

    it('should format with decimals', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });
  });
});

describe('API Types', () => {
  it('should have correct Recording interface', async () => {
    const { api } = await import('../src/lib/api');
    expect(api).toBeDefined();
    expect(typeof api.getRecordings).toBe('function');
    expect(typeof api.getRecording).toBe('function');
    expect(typeof api.createRecording).toBe('function');
    expect(typeof api.deleteRecording).toBe('function');
  });

  it('should have correct TestSpec interface', async () => {
    const { api } = await import('../src/lib/api');
    expect(typeof api.getTestSpecs).toBe('function');
    expect(typeof api.getTestSpec).toBe('function');
    expect(typeof api.generateTestSpec).toBe('function');
    expect(typeof api.updateTestSpec).toBe('function');
  });

  it('should have correct TestRun interface', async () => {
    const { api } = await import('../src/lib/api');
    expect(typeof api.getTestRuns).toBe('function');
    expect(typeof api.getTestRun).toBe('function');
    expect(typeof api.createTestRun).toBe('function');
  });
});

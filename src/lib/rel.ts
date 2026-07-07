import type { RelType } from '../types'

// 四类单词关系的颜色 + 中文名
export const REL: Record<RelType, { color: string; label: string }> = {
  synonym: { color: '#9ECE6A', label: '近义' },
  antonym: { color: '#F7768E', label: '反义' },
  sentence: { color: '#E0AF68', label: '造句' },
  colloquial: { color: '#2AC3DE', label: '谐音' },
}

// 一个词根 = 一颗恒星
export interface Root {
  id: string
  root: string // 显示用，如 "spect / spic"
  meaning_en: string
  meaning_zh: string
  origin: string
  color: string
  source?: string
}

// 一个单词 = 一颗行星，挂在某词根下
export interface Word {
  id: string
  word: string
  rootId: string
  phonetic: string
  pos: string
  def_en: string
  def_zh: string
  breakdown: string // 词根拆解，如 "in-(向内) + spect(看) → 检查"
  example: string
  ielts_band?: string
  source?: string
}

// 掌握度
export type Mastery = 'new' | 'fuzzy' | 'mastered'

// 单词学习进度（存 localStorage）
export interface Progress {
  status: Mastery
  // SRS 字段（后续阶段用）
  srs?: { due: string; interval: number; ease: number; reps: number }
}

// 单词与单词之间的关系类型
export type RelType = 'synonym' | 'antonym' | 'sentence' | 'colloquial'

// 一条单词关系（不同/相同词根的词互相链接）
export interface WordLink {
  a: string
  b: string
  type: RelType
  note: string // 近义说明 / 例句 / 谐音助记
}

// force-graph 用的节点 / 连线
export interface GraphNode {
  id: string
  kind: 'root' | 'word'
  label: string
  sub?: string // 读音 / 词根含义
  color: string
  rootId: string // word 指向其 root；root 指向自己
  val: number // 节点大小
}

export interface GraphLink {
  source: string
  target: string
  color: string
  kind: 'member' | 'rel' // member=词→词根；rel=词→词
  relType?: RelType
  note?: string
  width: number
  baseHex?: string // 关系链点亮/还原用的基础色
  baseAlpha?: number // 基础不透明度
}

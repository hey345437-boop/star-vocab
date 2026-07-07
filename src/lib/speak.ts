// 用浏览器自带的语音合成读单词 / 例句（离线、免费、无需 API）
let preferred: SpeechSynthesisVoice | null = null

function pickVoice(): SpeechSynthesisVoice | null {
  if (preferred) return preferred
  const voices = window.speechSynthesis?.getVoices?.() ?? []
  // 优先英式/美式英语、女声常见名
  preferred =
    voices.find((v) => /en-GB/i.test(v.lang)) ||
    voices.find((v) => /en-US/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null
  return preferred
}

// 有些浏览器要等 voiceschanged 才拿得到声音
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    preferred = null
    pickVoice()
  }
}

export function speak(text: string, rate = 0.92) {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = rate
  const v = pickVoice()
  if (v) u.voice = v
  synth.speak(u)
}

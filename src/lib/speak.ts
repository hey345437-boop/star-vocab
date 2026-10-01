// 使用电脑/浏览器提供的英语声音，不向外部服务发送单词。
function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices()
  return voices.find((voice) => /^en-GB/i.test(voice.lang))
    ?? voices.find((voice) => /^en-US/i.test(voice.lang))
    ?? voices.find((voice) => /^en/i.test(voice.lang))
    ?? null
}

export function stopSpeaking() {
  try { if (typeof window !== 'undefined') window.speechSynthesis?.cancel() } catch { /* 不支持语音不影响学习。 */ }
}

export function speak(text: string, rate = 0.92, onError?: () => void): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined' || !text.trim()) return false
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(synth)
    utterance.lang = voice?.lang ?? 'en-US'
    utterance.rate = Number.isFinite(rate) ? Math.max(0.5, Math.min(1.5, rate)) : 0.92
    if (voice) utterance.voice = voice
    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') onError?.()
    }
    synth.speak(utterance)
    return true
  } catch {
    onError?.()
    return false
  }
}

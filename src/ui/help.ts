/** Field-manual overlay. Two open modes: the ? button opens it sticky (stays
 * until ✕, click-outside, or Escape); holding the ? key shows it only for the
 * duration of the press. */
export function bindHelp(): void {
  const help = document.getElementById('help') as HTMLElement
  const card = document.getElementById('help-card') as HTMLElement
  const btn = document.getElementById('help-btn') as HTMLElement
  const close = document.getElementById('help-close') as HTMLElement
  let sticky = false

  const show = (isSticky: boolean): void => {
    sticky = isSticky
    help.classList.remove('hidden')
  }
  const hide = (): void => {
    sticky = false
    help.classList.add('hidden')
  }
  const visible = (): boolean => !help.classList.contains('hidden')

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    visible() && sticky ? hide() : show(true)
  })
  close.addEventListener('click', hide)
  help.addEventListener('click', (e) => {
    if (!card.contains(e.target as Node)) hide() // click-outside the card
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === '?' && !e.repeat) {
      if (!visible()) show(false) // hold-to-show
    } else if (e.key === 'Escape' && visible()) {
      hide()
    }
  })
  window.addEventListener('keyup', (e) => {
    // release of the ? chord (?, its base /, or Shift) ends a hold-open
    if (!sticky && visible() && (e.key === '?' || e.key === '/' || e.key === 'Shift')) hide()
  })
}

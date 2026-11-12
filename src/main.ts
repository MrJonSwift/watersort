/**
 * Wiring only: build the ports, hand them to the controller, start it.
 *
 * Everything that decides anything lives in `game/controller.ts`. If this file
 * grows a game rule, a state variable or a check on whether something is
 * animating, the logic has leaked out of the controller.
 */
import './style.css'
import { createAudio } from './game/audio'
import { createController } from './game/controller'
import { generateLevel } from './game/generator'
import { haptic, preventDoubleTapZoom } from './game/input'
import { MAX_LEVEL } from './game/levels'
import { applyPaletteToCss } from './game/palette'
import { loadProgress, saveProgress } from './game/progress'
import { parseLevelJump } from './game/query'
import { loadSettings, saveSettings } from './game/settings'
import { createGame } from './game/state'
import { createUI } from './game/ui'
import { createStage } from './game/water/stage'

/**
 * Drop `?level=N` from the address bar once the controller has taken it.
 * The jump is saved as the play position, so the parameter has done its job
 * and a later reload must not re-apply it over a level the player advanced to.
 */
function consumeLevelJump(): void {
  const url = new URL(location.href)
  url.searchParams.delete('level')
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element
}

applyPaletteToCss()

const app = requireElement('#app')
const audio = createAudio()
const stage = createStage(app)

// The UI needs its handlers up front and the handlers need the controller, so
// the controller is assigned just below, before anything can be clicked.
let controller: ReturnType<typeof createController>

const ui = createUI(app, {
  onTap: (index) => controller.tap(index),
  onUndo: () => controller.undo(),
  onPrimary: () => controller.primary(),
  onToggleSound: () => controller.toggleSound(),
  onTogglePourFx: () => controller.togglePourFx(),
  onAnswer: (index) => controller.answer(index),
  onDismiss: () => controller.dismiss(),
})

const startAt = parseLevelJump(location.search, MAX_LEVEL)

controller = createController({
  ui,
  stage,
  audio,
  haptic,
  settings: { load: loadSettings, save: saveSettings },
  progress: { load: loadProgress, save: saveProgress },
  startAt: startAt ?? undefined,
  board: (level) => createGame(generateLevel(level).board),
})

preventDoubleTapZoom(app)
controller.start()
if (startAt !== null) consumeLevelJump()

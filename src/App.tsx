import { useState } from "react"
import World from "./game/World"
import HUD from "./components/hud/HUD"

function App() {
  const [uiBlocking, setUiBlocking] = useState(false)

  return (
    <>
      <World controlsEnabled={!uiBlocking} />
      <HUD onUiBlockingChange={setUiBlocking} />
    </>
  )
}

export default App

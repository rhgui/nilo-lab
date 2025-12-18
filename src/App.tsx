import { useState } from "react"
import World from "./game/World"
import HUD from "./components/hud/HUD"
import defaultSkyboxUrl from "./assets/default_skybox.png"
import CharacterSetup from "./components/character/CharacterSetup"

function App() {
  const [uiBlocking, setUiBlocking] = useState(false)
  const [skyboxUrl, setSkyboxUrl] = useState<string>(defaultSkyboxUrl)
  const [playerName, setPlayerName] = useState<string>(() => localStorage.getItem("playerName") ?? "")

  return (
    <>
      {playerName ? (
        <>
          <World controlsEnabled={!uiBlocking} skyboxUrl={skyboxUrl} playerName={playerName} />
          <HUD onUiBlockingChange={setUiBlocking} onSkyboxUrlChange={setSkyboxUrl} />
        </>
      ) : (
        <CharacterSetup
          onConfirm={(name) => {
            localStorage.setItem("playerName", name)
            setPlayerName(name)
          }}
        />
      )}
    </>
  )
}

export default App

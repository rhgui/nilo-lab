# Nilo Lab

Nilo Lab is a real-time, collaborative 3D world-building experience that integrates AI-powered asset generation. Built with React, Three.js, and Liveblocks, it allows multiple users to join a shared world, create 3D assets using text and drawings, modify the terrain, and place objects.

## Features

- **Real-time Multiplayer:** A shared, persistent world where users can see and interact with each other's avatars and creations in real-time, powered by Liveblocks.
- **AI-Powered Asset Generation:** Utilizes the Meshy.ai API (via a dedicated backend proxy) for generating in-game assets:
    - **Text-to-3D:** Generate 3D character models and objects from text prompts.
    - **Image-to-3D:** Draw an object, refine it with AI image-to-image prompts, and then convert the final image into a 3D model.
    - **Text-to-Skybox:** Dynamically change the world's skybox by describing a scene.
- **Collaborative Terrain Editor:** Switch to a free-flying camera mode to collaboratively edit the landscape. Tools include raising, lowering, smoothing, painting, and resetting the terrain. All changes are synchronized across clients.
- **Dynamic Inventory:** An inventory system that holds default primitives and community-generated models, allowing users to place them in the world.
- **Persistent World:** All placed items, community models, and terrain modifications are persisted using Liveblocks storage, so the world state is saved between sessions.
- **Interactive UI:**
    - A character creation screen to set a player name and generate a custom 3D avatar.
    - An in-game Heads-Up Display (HUD) with a radial menu for quick access to generation tools and game modes.
    - Modals for drawing, text prompts, and browsing community-created models.

## Technology Stack

- **Frontend:** React, TypeScript, Three.js, Vite
- **Backend:** Node.js, Express
- **Real-time Collaboration:** Liveblocks
- **AI Services:** Meshy.ai
- **Deployment:** Includes configuration for Vercel (`vercel.json`), Fly.io (`fly.toml`), and Render (`render.yaml`).

## Getting Started

Follow these instructions to get a local copy of the project up and running.

### Prerequisites

- Node.js (v18 or later)
- npm

### Installation

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/rhgui/nilo-lab.git
    cd nilo-lab
    ```

2.  **Install dependencies:**
    ```sh
    npm install
    ```

### Configuration

1.  Create a `.env` file in the root of the project.
2.  Add your API keys to the `.env` file. You will need keys from [Liveblocks](https://liveblocks.io/) and [Meshy.ai](https://www.meshy.ai/).

    ```env
    # Public key from your Liveblocks project
    VITE_LIVEBLOCKS_PUBLIC_KEY="pk_your_public_key"    
    # API key from Meshy.ai
    MESHY_API_KEY="your_meshy_api_key"
    ```

### Running the Application

This project uses `concurrently` to run the frontend development server and the backend Express server with a single command.

```sh
npm run dev
```

- The Vite frontend will be available at `http://localhost:5173`.
- The Express backend server will run on `http://localhost:3000`.

The Vite development server is configured to proxy all API requests from `/api` to the backend server.

## Project Structure

-   `server.js`: The Express backend that serves as a secure proxy for the Meshy.ai API. It handles all AI generation requests.
-   `/src/game`: Contains the core Three.js logic.
    -   `World.tsx`: The main component that initializes the Three.js scene, manages game state, and renders the 3D environment.
    -   `PlayerController.ts`: Handles first-person player movement (WASD, jump, mouse look).
    -   `FreeCameraController.ts`: A fly-cam controller for the terrain editor mode.
    -   `ThirdPersonCamera.ts`: A follow-camera for the player character.
-   `/src/components`: Contains all React UI components.
    -   `hud/`: Components for the in-game HUD, including the radial menu, inventory, and toolbars.
    -   `character/`: The character creation and customization screen.
    -   `loading/`: The loading screen component.
-   `/src/liveblocks.config.ts`: Defines the data structures (`Presence` and `Storage`) for Liveblocks collaboration.
-   `/src/services`: Contains client-side functions for making requests to the backend API endpoints.

## AI Usage

This project was done using Cursor IDE.

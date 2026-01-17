# Nilo Lab

Nilo Lab is a real-time, collaborative 3D world-building experience that integrates AI-powered asset generation. Built with React, Three.js, and Liveblocks, it allows multiple users to join a shared world, create 3D assets using text and drawings, modify the terrain, and place objects.

## Some Previews

<img width="650" height="400" alt="image" src="https://github.com/user-attachments/assets/d8e7f638-c678-4b23-9d6a-d1bbc0ac175e" />
<img width="650" height="400" alt="image" src="https://github.com/user-attachments/assets/7f6357f8-a771-4d68-902c-5755a2d32819" />

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

## AI Usage

This project was done using Cursor IDE.

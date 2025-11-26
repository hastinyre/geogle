import { GameLobby } from "./gameLobby.js";

export { GameLobby };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Handle WebSockets (The Game Logic)
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      let lobbyCode = url.searchParams.get("lobby") || "default";
      const id = env.LOBBY.idFromName(lobbyCode);
      const lobbyObject = env.LOBBY.get(id);

      return lobbyObject.fetch(request);
    }

    // 2. Handle Static Assets (HTML, CSS, Images)
    // env.ASSETS is a special binding provided by the --assets flag
    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return new Response("Not found", { status: 404 });
    }
  }
};
class NativeSocket {
  constructor() {
    this.events = {};
    this.id = null;
    
    // 1. Session Persistence: Recover ID from storage
    this.sessionId = localStorage.getItem("geogle_session_id") || null;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    // Pass session ID in URL for immediate server recognition
    const query = this.sessionId ? `?sessionId=${this.sessionId}` : "";
    this.url = `${protocol}://${host}/ws${query}`;
    
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("Connected to Cloudflare Worker");
    };

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        
        // 2. Heartbeat: Automatically reply to pings
        if (data.event === "ping") {
          this.emit("pong", {});
          return;
        }

        // 3. Init: Store the Session ID assigned by server
        if (data.event === "init") {
          this.id = data.id;
          if (data.sessionId) {
            this.sessionId = data.sessionId;
            localStorage.setItem("geogle_session_id", this.sessionId);
          }
          if (this.events["connect"]) this.events["connect"].forEach(cb => cb());
          return;
        }

        if (this.events[data.event]) {
          this.events[data.event].forEach(cb => cb(data.payload));
        }
      } catch (e) {
        console.error("Socket error:", e);
      }
    };

    this.ws.onclose = () => {
      console.log("Disconnected. Reconnecting...");
      setTimeout(() => this.connect(), 3000);
    };
  }

  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
  }

  emit(event, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, payload }));
    } else {
      console.warn("Socket not ready");
    }
  }
  
  removeAllListeners(event) {
    if (event) delete this.events[event];
    else this.events = {};
  }
}

window.NativeSocket = NativeSocket;
class NativeSocket {
  constructor() {
    this.events = {};
    this.id = null; 
    
    // 1. Session Persistence: Check for existing session
    this.sessionId = localStorage.getItem("geogle_session_id") || null;

    // Determine WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    this.url = `${protocol}://${host}/ws`;
    
    this.connect();
  }

  connect() {
    // Append sessionId to URL if it exists so server can identify us
    const fullUrl = this.sessionId ? `${this.url}?sessionId=${this.sessionId}` : this.url;
    this.ws = new WebSocket(fullUrl);

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

        // 3. Init: Save new ID and Session
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
  
  once(event, callback) {
    const wrapper = (payload) => {
      callback(payload);
      this.events[event] = this.events[event].filter(cb => cb !== wrapper);
    };
    this.on(event, wrapper);
  }
}

window.NativeSocket = NativeSocket;
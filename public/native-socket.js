class NativeSocket {
  constructor() {
    this.events = {};
    this.id = null; // Will be assigned by server
    
    // Determine WebSocket URL (secure wss:// or ws://)
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    this.url = `${protocol}://${host}/ws`;
    
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
        
        // Special case: Server assigning ID
        if (data.event === "init") {
          this.id = data.id;
          // Also trigger 'connect' event for client logic
          if (this.events["connect"]) this.events["connect"].forEach(cb => cb());
          return;
        }

        // Normal events
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

  // Mimic socket.on('eventName', callback)
  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
  }

  // Mimic socket.emit('eventName', data)
  emit(event, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, payload }));
    } else {
      console.warn("Socket not ready, queuing not implemented yet");
    }
  }
  
  // Cleanup listener
  removeAllListeners(event) {
    if (event) delete this.events[event];
    else this.events = {};
  }
  
  // Single use listener (simple implementation)
  once(event, callback) {
    const wrapper = (payload) => {
      callback(payload);
      // Remove specific wrapper from array - simplifed for now
      this.events[event] = this.events[event].filter(cb => cb !== wrapper);
    };
    this.on(event, wrapper);
  }
}

// Expose globally so client.js can see it
window.NativeSocket = NativeSocket;
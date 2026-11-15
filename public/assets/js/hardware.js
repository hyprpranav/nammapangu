/**
 * NAMMAPANGU - HARDWARE COMMUNICATION MODULE (ESP32 WEB SERIAL & SIMULATOR)
 * Web Serial API for Chrome/Edge with JSON Protocol at 115200 Baud.
 */

class HardwareManager {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.isConnected = false;
    this.baudRate = 115200;
    this.isSimulatorActive = false;
    this.lastWeight = 0.00;
    this.isStable = true;
    this.servoState = "CLOSED";
    this.lastRfidUid = null;
    this.serialBuffer = "";
    this.onLogCallback = null;

    // Check Web Serial support
    this.isSupported = "serial" in navigator;
  }

  /**
   * Request user permission and connect to ESP32 via Web Serial.
   */
  async connect() {
    if (!this.isSupported) {
      throw new Error("Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera.");
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: this.baudRate });

      this.isConnected = true;
      this.isSimulatorActive = false;
      this.notifyConnection(true);

      // Setup writer
      const textEncoder = new TextEncoderStream();
      const writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
      this.writer = textEncoder.writable.getWriter();

      // Setup reader
      this.readLoop();

      this.log("Connected to ESP32 Serial Port at 115200 baud.");
      return true;
    } catch (err) {
      this.isConnected = false;
      this.notifyConnection(false);
      this.log("Connection failed: " + err.message, "error");
      throw err;
    }
  }

  /**
   * Disconnect from serial port.
   */
  async disconnect() {
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader = null;
      }
      if (this.writer) {
        await this.writer.close();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (e) {
      console.warn("Error during port close:", e);
    } finally {
      this.isConnected = false;
      this.notifyConnection(false);
      this.log("Disconnected from ESP32.");
    }
  }

  /**
   * Continuous read loop for incoming serial lines.
   */
  async readLoop() {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this.serialBuffer += value;
          const lines = this.serialBuffer.split("\n");
          this.serialBuffer = lines.pop(); // keep partial line

          for (const line of lines) {
            const cleanLine = line.trim();
            if (cleanLine.length > 0) {
              this.handleIncomingLine(cleanLine);
            }
          }
        }
      }
    } catch (err) {
      this.log("Serial read error: " + err.message, "error");
    } finally {
      this.reader.releaseLock();
    }
  }

  /**
   * Parse incoming JSON message from ESP32.
   */
  handleIncomingLine(line) {
    this.log("RX: " + line);

    try {
      const data = JSON.parse(line);
      this.dispatchHardwareEvent(data);
    } catch (e) {
      // If line is plain text debug output from ESP32
      this.log("ESP32 DEBUG: " + line, "debug");
    }
  }

  /**
   * Dispatches typed events based on ESP32 message.
   */
  dispatchHardwareEvent(data) {
    if (!data || !data.type) return;

    switch (data.type) {
      case "RFID":
        this.lastRfidUid = data.uid ? data.uid.toUpperCase() : null;
        window.dispatchEvent(new CustomEvent("np:hardware:rfid", { detail: { uid: this.lastRfidUid } }));
        break;

      case "WEIGHT":
        this.lastWeight = parseFloat(data.value) || 0.00;
        this.isStable = !!data.stable;
        window.dispatchEvent(new CustomEvent("np:hardware:weight", {
          detail: { value: this.lastWeight, unit: data.unit || "kg", stable: this.isStable }
        }));
        break;

      case "SERVO":
        this.servoState = data.state || "CLOSED";
        window.dispatchEvent(new CustomEvent("np:hardware:servo", { detail: { state: this.servoState } }));
        break;

      case "STATUS":
        window.dispatchEvent(new CustomEvent("np:hardware:status", { detail: { state: data.state } }));
        break;

      case "ERROR":
        this.log("ESP32 Error: " + data.message, "error");
        window.dispatchEvent(new CustomEvent("np:hardware:error", { detail: { message: data.message } }));
        break;

      default:
        console.log("Unknown hardware event:", data);
    }
  }

  /**
   * Send JSON command to ESP32.
   */
  async sendCommand(cmdObject) {
    const jsonStr = JSON.stringify(cmdObject) + "\n";
    this.log("TX: " + jsonStr.trim());

    if (this.isConnected && this.writer) {
      await this.writer.write(jsonStr);
      return true;
    } else if (this.isSimulatorActive) {
      this.simulateCommandResponse(cmdObject);
      return true;
    } else {
      throw new Error("ESP32 is not connected. Connect device or enable Hardware Simulator.");
    }
  }

  // Convenience command triggers
  async requestScan() {
    return this.sendCommand({ command: "SCAN" });
  }

  async tareWeight() {
    return this.sendCommand({ command: "TARE" });
  }

  async startDispense(targetKg) {
    return this.sendCommand({ command: "DISPENSE", target: parseFloat(targetKg) });
  }

  async emergencyStop() {
    return this.sendCommand({ command: "STOP" });
  }

  async notifyUserValid() {
    try {
      return await this.sendCommand({ command: "USER_VALID" });
    } catch (e) {
      console.log("Hardware offline, ignoring LED/Buzzer command:", e.message);
    }
  }

  async notifyUserInvalid() {
    try {
      return await this.sendCommand({ command: "USER_INVALID" });
    } catch (e) {
      console.log("Hardware offline, ignoring LED/Buzzer command:", e.message);
    }
  }

  async notifyRegistering() {
    try {
      return await this.sendCommand({ command: "REGISTERING" });
    } catch (e) {
      console.log("Hardware offline, ignoring LED/Buzzer command:", e.message);
    }
  }

  async setLedColor(color) {
    try {
      return await this.sendCommand({ command: "LED_" + color.toUpperCase() });
    } catch (e) {
      console.log("Hardware offline, ignoring LED command:", e.message);
    }
  }

  async triggerBuzzer() {
    try {
      return await this.sendCommand({ command: "BUZZER" });
    } catch (e) {
      console.log("Hardware offline, ignoring buzzer command:", e.message);
    }
  }

  /**
   * Hardware Simulator Mode for demonstration when ESP32 is not physically plugged in.
   */
  enableSimulator(enabled = true) {
    this.isSimulatorActive = enabled;
    if (enabled && !this.isConnected) {
      this.log("Hardware Simulator activated. You can simulate RFID scan and dispensing.");
      this.notifyConnection(true, true);
    } else if (!enabled && !this.isConnected) {
      this.notifyConnection(false);
      this.log("Hardware Simulator deactivated.");
    }
  }

  simulateRfidScan(uid = "A1B2C3D4") {
    if (!this.isConnected && !this.isSimulatorActive) {
      this.enableSimulator(true);
    }
    this.log(`SIM: Simulating RFID scan with UID: ${uid}`);
    this.dispatchHardwareEvent({ type: "RFID", uid: uid });
  }

  simulateCommandResponse(cmd) {
    if (cmd.command === "TARE") {
      this.lastWeight = 0.00;
      this.dispatchHardwareEvent({ type: "WEIGHT", value: 0.00, unit: "kg", stable: true });
      this.dispatchHardwareEvent({ type: "STATUS", state: "TARED" });
    } else if (cmd.command === "DISPENSE") {
      const target = cmd.target || 1.0;
      this.servoState = "OPEN";
      this.dispatchHardwareEvent({ type: "SERVO", state: "OPEN" });
      this.log(`SIM: Dispenser gate OPEN. Dispensing target: ${target} KG`);

      // Gradual weight increase simulation
      let current = 0.0;
      const interval = setInterval(() => {
        current += 0.20;
        const currentRounded = Math.round(current * 100) / 100;
        this.dispatchHardwareEvent({ type: "WEIGHT", value: currentRounded, unit: "kg", stable: false });

        if (current >= target) {
          clearInterval(interval);
          this.servoState = "CLOSED";
          const finalWeight = Math.round((target + (Math.random() * 0.03)) * 100) / 100;
          this.dispatchHardwareEvent({ type: "WEIGHT", value: finalWeight, unit: "kg", stable: true });
          this.dispatchHardwareEvent({ type: "SERVO", state: "CLOSED" });
          this.dispatchHardwareEvent({ type: "STATUS", state: "COMPLETED" });
          this.log(`SIM: Target reached. Gate CLOSED. Final weight: ${finalWeight} KG`);
        }
      }, 350);
    } else if (cmd.command === "STOP") {
      this.servoState = "CLOSED";
      this.dispatchHardwareEvent({ type: "SERVO", state: "CLOSED" });
      this.dispatchHardwareEvent({ type: "STATUS", state: "STOPPED" });
      this.log("SIM: Emergency STOP triggered. Gate CLOSED.");
    }
  }

  notifyConnection(connected, isSim = false) {
    // Update header status pills across pages
    const pills = document.querySelectorAll(".hardware-quick-badge");
    pills.forEach(pill => {
      if (connected) {
        pill.classList.add("connected");
        pill.innerHTML = `<span class="pulse-dot"></span> <span>${isSim ? 'ESP32 (Sim)' : 'ESP32 Online'}</span>`;
      } else {
        pill.classList.remove("connected");
        pill.innerHTML = `<span class="pulse-dot"></span> <span>ESP32 Disconnected</span>`;
      }
    });

    window.dispatchEvent(new CustomEvent("np:hardware:connection", { detail: { connected, isSim } }));
  }

  log(msg, level = "info") {
    console.log(`[HW] ${msg}`);
    if (typeof this.onLogCallback === "function") {
      this.onLogCallback(msg, level);
    }
  }
}

// Global Hardware Singleton
window.NPHardware = new HardwareManager();

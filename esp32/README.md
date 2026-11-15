# NAMMAPANGU (நம்ம பங்கு) – SINGLE ALL-IN-ONE ESP32 FIRMWARE
## Tamil Nadu Smart Ration Distribution & RFID Management System

This directory contains the **single consolidated Arduino firmware file** (`nammapangu_esp32.ino`) for the **NAMMAPANGU** IoT smart ration dispensing unit.

Everything—pin assignments, sensor reading, HX711 load cell calibration, servo gate actuator control, I2C LCD messaging, and Web Serial JSON communication—is packaged into this **single standalone file**. You can open it directly in the Arduino IDE and upload it to your 30-pin ESP32 with zero file management.

---

## 1. HARDWARE SPECIFICATIONS & PIN ASSIGNMENTS

Target Microcontroller: **ESP32 30-Pin Development Board (NodeMCU / DevKit V1)**

| Component | Pin Function | ESP32 GPIO | Voltage Requirement | Wiring Notes |
| :--- | :--- | :--- | :--- | :--- |
| **RC522 RFID** | SDA / SS | **GPIO 5** | 3.3V Only | SPI Chip Select |
| | SCK | **GPIO 18** | | SPI Clock |
| | MOSI | **GPIO 23** | | SPI Master-Out Slave-In |
| | MISO | **GPIO 19** | | SPI Master-In Slave-Out |
| | RST | **GPIO 4** | | Hardware Reset |
| | 3.3V | **3V3** | | **DO NOT connect to 5V! 3.3V ONLY** |
| | GND | **GND** | | Common Ground |
| **HX711 Load Cell** | DT / DOUT | **GPIO 32** | 3.3V or 5V | Serial Data Line |
| | SCK | **GPIO 33** | | Serial Clock Pulse |
| | E+, E-, A+, A- | Load Cell Wires | | Red(E+), Black(E-), White(A-), Green(A+) |
| **I2C LCD (16x2)** | SDA | **GPIO 21** | 5V / 3.3V | I2C Data (Auto-detects 0x27 or 0x3F) |
| | SCL | **GPIO 22** | | I2C Clock |
| **Servo Motor** | Signal (PWM) | **GPIO 13** | 5V | PWM Actuator (0° Closed, 90° Open) |
| | Power (V+) | Regulated 5V | | Connect to VIN or external 5V |
| | GND | Common GND | | Must share common ground with ESP32 |
| **Single LED** | Anode (+) | **GPIO 25** | 3.3V | In series with 220Ω - 330Ω resistor |
| | Cathode (-) | **GND** | | Dedicated system status indicator |

> [!CAUTION]
> **STRICT HARDWARE RESTRICTIONS**: Only the components listed above are used. No ultrasonic sensors (HC-SR04), extra LEDs, extra RFID readers, or unrequested hardware.

---

## 2. HOW TO UPLOAD IN ARDUINO IDE

### Step 1: Open Arduino IDE
1. Open Arduino IDE.
2. Open the file: `esp32/nammapangu_esp32.ino`.

### Step 2: Select Your ESP32 Board & Port
1. Go to **Tools > Board > ESP32 Arduino > DOIT ESP32 DEVKIT V1** (or ESP32 Dev Module).
2. Go to **Tools > Port** and select the COM port of your plugged-in ESP32.

### Step 3: Install Required Libraries (From Library Manager)
Go to **Tools > Manage Libraries...** (Ctrl+Shift+I) and search & install:
1. **MFRC522** (by GithubCommunity)
2. **HX711 Arduino Library** (by Bogdan Necula)
3. **ESP32Servo** (by Kevin Harrington)
4. **LiquidCrystal I2C** (by Frank de Brabander or Marco Schwartz)

*(No external JSON library required! The firmware includes lightweight built-in JSON parsing and serialization to avoid library version mismatches).*

### Step 4: Click Upload (Arrow Button)
1. Click the **Upload** button.
2. If your ESP32 gets stuck on `Connecting........_____`, press and hold the **BOOT** button on the ESP32 board for 2 seconds until uploading begins.
3. Once done, open the **Serial Monitor** at **115200 baud**.

---

## 3. LOAD CELL CALIBRATION

At line 68 of `nammapangu_esp32.ino`:
```cpp
#define LOADCELL_CAL_FACTOR     420.5f  // Adjust for your physical load cell
```
1. Upload the code with no weight on the load cell tray.
2. The scale will automatically tare to `0.00 KG`.
3. Place a known object (e.g. 1.00 KG).
4. If the serial monitor reads e.g. `0.85 KG`, calculate:
   $$\text{New Factor} = 420.5 \times \left(\frac{0.85}{1.00}\right) = 357.4$$
5. Update `LOADCELL_CAL_FACTOR` and re-upload.

---

## 4. BROWSER WEB SERIAL COMMUNICATION (115200 BAUD)

The single firmware is 100% synchronized with the web portal (`hardware.js` and `landing-kiosk.js`).

### Outgoing Messages from ESP32 to Web Dashboard:
- `{"type":"HEARTBEAT","uptime":25,"state":"READY"}`
- `{"type":"RFID","uid":"A1B2C3D4"}`
- `{"type":"WEIGHT","value":1.00,"unit":"kg","stable":true}`
- `{"type":"SERVO","state":"OPEN"}` / `{"type":"SERVO","state":"CLOSED"}`
- `{"type":"STATUS","state":"READY"}` / `{"type":"STATUS","state":"COMPLETED"}` / `{"type":"STATUS","state":"TARED"}` / `{"type":"STATUS","state":"STOPPED"}`
- `{"type":"ERROR","message":"..."}`

### Incoming Commands from Dashboard:
- `{"command":"SCAN"}` -> Arms scanner & updates LCD
- `{"command":"TARE"}` -> Zeroes the scale to 0.00 KG
- `{"command":"DISPENSE","target":1.0}` -> Opens servo gate, measures live weight, and shuts off when target is reached
- `{"command":"STOP"}` -> Immediate emergency gate cutoff

/**
 * ====================================================================================
 * NAMMAPANGU (நம்ம பங்கு) - COMPLETE ALL-IN-ONE ESP32 FIRMWARE
 * Smart Ration Distribution & RFID Management System
 * Target Board: ESP32 30-Pin NodeMCU / DevKit V1
 * ====================================================================================
 * 
 * HARDWARE COMPONENTS IN USE (ONLY THESE COMPONENTS):
 *   1. ESP32 30-Pin Microcontroller
 *   2. RC522 RFID Reader (SPI 13.56 MHz)
 *   3. HX711 Load Cell Amplifier + Load Cell (Weight Measurement)
 *   4. 16x2 I2C Character LCD (Display)
 *   5. One Micro Servo Motor (SG90 / MG90S - Dispenser Gate)
 *   6. One Indicator LED (System Status on dedicated GPIO)
 * 
 * ------------------------------------------------------------------------------------
 * ESP32 30-PIN WIRING GUIDE:
 * ------------------------------------------------------------------------------------
 * 1. RC522 RFID MODULE (SPI):
 *    - 3.3V  -> ESP32 3V3 (CAUTION: 3.3V ONLY! Do NOT connect to 5V)
 *    - GND   -> ESP32 GND
 *    - RST   -> ESP32 GPIO 4
 *    - MISO  -> ESP32 GPIO 19
 *    - MOSI  -> ESP32 GPIO 23
 *    - SCK   -> ESP32 GPIO 18
 *    - SDA/SS-> ESP32 GPIO 5
 * 
 * 2. HX711 LOAD CELL AMPLIFIER:
 *    - VCC   -> ESP32 VIN (5V) or 3V3
 *    - GND   -> ESP32 GND
 *    - DT    -> ESP32 GPIO 32
 *    - SCK   -> ESP32 GPIO 33
 *    (Load Cell Wires to HX711: Red=E+, Black=E-, White=A-, Green=A+)
 * 
 * 3. 16x2 I2C LCD DISPLAY:
 *    - VCC   -> ESP32 VIN (5V)
 *    - GND   -> ESP32 GND
 *    - SDA   -> ESP32 GPIO 21
 *    - SCL   -> ESP32 GPIO 22
 * 
 * 4. SERVO MOTOR (DISPENSER GATE):
 *    - RED   -> ESP32 VIN (5V)
 *    - BROWN -> ESP32 GND
 *    - ORANGE-> ESP32 GPIO 13 (PWM Signal)
 * 
 * 5. INDICATOR LEDS & BUZZER:
 *    - BLUE LED (Scanning Mode)  -> ESP32 GPIO 26 (Through 220-330 ohm resistor to GND)
 *    - GREEN LED (Valid / Dispense)-> ESP32 GPIO 27 (Through 220-330 ohm resistor to GND)
 *    - RED LED (Unregistered/Err)-> ESP32 GPIO 16 (RX2) (Through 220-330 ohm resistor to GND)
 *    - BUZZER (Audio Alerts)     -> ESP32 GPIO 17 (TX2) (Positive to GPIO 17, Negative to GND)
 *    - ONBOARD/AUX LED           -> ESP32 GPIO 25 (Auxiliary indicator)
 * 
 * ------------------------------------------------------------------------------------
 * ARDUINO IDE REQUIRED LIBRARIES:
 * Go to: Tools -> Manage Libraries... and install:
 *   1. "MFRC522" by GithubCommunity
 *   2. "HX711 Arduino Library" by Bogdan Necula, Andreas Motl
 *   3. "ESP32Servo" by Kevin Harrington
 *   4. "LiquidCrystal I2C" by Frank de Brabander (or Marco Schwartz)
 * ====================================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <LiquidCrystal_I2C.h>
#include <MFRC522.h>
#include <HX711.h>
#include <ESP32Servo.h>

// ====================================================================================
// 1. PIN CONFIGURATIONS & CONSTANTS
// ====================================================================================
#define SERIAL_BAUD_RATE        115200

// RC522 RFID Pins (Hardware SPI)
#define RFID_SS_PIN             5
#define RFID_RST_PIN            4
#define RFID_SCK_PIN            18
#define RFID_MISO_PIN           19
#define RFID_MOSI_PIN           23

// HX711 Load Cell Pins
#define HX711_DOUT_PIN          32
#define HX711_SCK_PIN           33
#define LOADCELL_CAL_FACTOR     420.5f  // Adjust this calibration factor for your physical load cell

// I2C LCD Settings
#define I2C_SDA_PIN             21
#define I2C_SCL_PIN             22
#define LCD_COLUMNS             16
#define LCD_ROWS                2

// Servo Motor Pin & Angles
#define SERVO_PIN               13
#define SERVO_CLOSED_ANGLE      0       // Gate locked shut
#define SERVO_OPEN_ANGLE        90      // Gate open for dispensing

// 3-Color Indicator LEDs & Buzzer Pins
#define LED_BLUE_PIN            26      // RFID Scanning Active / Standby Mode (Blue)
#define LED_GREEN_PIN           27      // User Registered / Dispensing / Purchasing (Green)
#define LED_RED_PIN             16      // User Not Registered / Error / Safety Cutoff (Red)
#define BUZZER_PIN              17      // Audio Beeper Alerts (Beep on card, alert on error)
#define STATUS_LED_PIN          25      // Aux Power / Status indicator

// Timing & Safety Constraints
#define RFID_DEBOUNCE_MS        2000    // Ignore same card reads within 2s
#define WEIGHT_STREAM_INTERVAL  200     // Stream live weight every 200ms during dispensing
#define HEARTBEAT_INTERVAL_MS   5000    // Send keep-alive heartbeat every 5s
#define DISPENSE_SAFETY_TIMEOUT 30000   // Auto-abort dispensing after 30 seconds

// ====================================================================================
// 2. HARDWARE INSTANCES & STATE DEFINITIONS
// ====================================================================================
enum SystemState {
  STATE_BOOTING,
  STATE_READY,
  STATE_CARD_DETECTED,
  STATE_DISPENSING,
  STATE_COMPLETED,
  STATE_STOPPED,
  STATE_ERROR
};

// Global Hardware Drivers
LiquidCrystal_I2C lcd(0x27, LCD_COLUMNS, LCD_ROWS); // Auto-checks 0x27 and 0x3F in setup
MFRC522 mfrc522(RFID_SS_PIN, RFID_RST_PIN);
HX711 scale;
Servo dispenserServo;

// Global State Variables
SystemState currentState = STATE_BOOTING;
float targetDispenseKg = 0.0f;
float liveWeightKg = 0.0f;
bool isGateOpen = false;
unsigned long dispenseStartTime = 0;
unsigned long lastWeightStreamTime = 0;
unsigned long lastHeartbeatTime = 0;
unsigned long lastRfidScanTime = 0;
String lastScannedUid = "";

// Serial Input Buffer
String serialInputBuffer = "";

// Forward Declarations
void setLedStatus(bool blue, bool green, bool red);
void beepBuzzer(int durationMs, int count = 1, int pauseMs = 80);
void setLed(bool on);
void setLedBlink(int times, int delayMs);
void updateLcd(const String &line1, const String &line2);
void openServoGate();
void closeServoGate();
void tareScale();
float readWeightKg(int samples = 1);
bool isWeightStable(float &stableWeight);
void startDispense(float targetKg);
void handleDispenseLoop();
void emergencyStop();
void processIncomingSerialLine(const String &line);
void sendSerialRfid(const String &uid);
void sendSerialWeight(float weightKg, bool stable);
void sendSerialServo(const String &state);
void sendSerialStatus(const String &state);
void sendSerialError(const String &message);
void sendSerialHeartbeat();

// ====================================================================================
// 3. SETUP & HARDWARE INITIALIZATION
// ====================================================================================
void setup() {
  // 1. Initialize Indicator LEDs & Audio Buzzer
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(LED_BLUE_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // Turn Blue LED ON (Scanning Mode Active), Green & Red OFF
  setLedStatus(true, false, false);
  setLed(true);
  beepBuzzer(90, 1); // Power-on acknowledge beep

  // 2. Initialize Serial at 115200 baud
  Serial.begin(SERIAL_BAUD_RATE);
  serialInputBuffer.reserve(128);

  delay(200);
  Serial.println();
  Serial.println(F("========================================================"));
  Serial.println(F("NAMMAPANGU - TAMIL NADU SMART RATION PDS SYSTEM"));
  Serial.println(F("ESP32 All-In-One Unified Firmware v3.0"));
  Serial.println(F("========================================================"));

  // 3. Initialize I2C Bus & LCD Display
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  
  // Test address 0x27 first, fallback to 0x3F if not responding
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() != 0) {
    lcd = LiquidCrystal_I2C(0x3F, LCD_COLUMNS, LCD_ROWS);
  }
  lcd.init();
  lcd.backlight();
  updateLcd("NAMMAPANGU", "TN-PDS SMART");
  delay(1000);

  // 4. Initialize Servo Motor Actuator
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  dispenserServo.setPeriodHertz(50); // Standard 50Hz servo
  dispenserServo.attach(SERVO_PIN, 500, 2400);
  closeServoGate();

  // 5. Initialize RC522 RFID Reader (SPI)
  SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
  mfrc522.PCD_Init();
  delay(10);
  byte rfidVer = mfrc522.PCD_ReadRegister(mfrc522.VersionReg);
  if (rfidVer == 0x00 || rfidVer == 0xFF) {
    sendSerialError("RC522_SPI_COMM_FAILURE_CHECK_PINS");
  } else {
    sendSerialStatus("RC522_ONLINE");
  }

  // 6. Initialize HX711 Load Cell Amplifier
  scale.begin(HX711_DOUT_PIN, HX711_SCK_PIN);
  unsigned long hxStart = millis();
  while (!scale.is_ready() && (millis() - hxStart < 1000)) {
    delay(50);
  }
  if (scale.is_ready()) {
    scale.set_scale(LOADCELL_CAL_FACTOR);
    scale.tare();
    sendSerialStatus("HX711_ONLINE");
  } else {
    sendSerialError("HX711_NOT_READY_CHECK_GPIO_32_33");
  }

  // Ready State reached
  currentState = STATE_READY;
  setLed(true); // Solid ON: System Ready
  updateLcd("NAMMAPANGU", "READY TO SCAN...");
  sendSerialStatus("READY");
  sendSerialServo("CLOSED");
  sendSerialWeight(0.00, true);
}

// ====================================================================================
// 4. MAIN RUN LOOP & STATE MACHINE
// ====================================================================================
void loop() {
  unsigned long now = millis();

  // ----------------------------------------------------------------------------------
  // 1. Process Incoming Web Serial Stream (from Browser / Dashboard)
  // ----------------------------------------------------------------------------------
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      serialInputBuffer.trim();
      if (serialInputBuffer.length() > 0) {
        processIncomingSerialLine(serialInputBuffer);
        serialInputBuffer = "";
      }
    } else {
      if (serialInputBuffer.length() < 128) {
        serialInputBuffer += c;
      }
    }
  }

  // ----------------------------------------------------------------------------------
  // 2. Periodic Keep-Alive Heartbeat (every 5 seconds)
  // ----------------------------------------------------------------------------------
  if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatTime = now;
    sendSerialHeartbeat();
  }

  // ----------------------------------------------------------------------------------
  // 3. State Machine Handling
  // ----------------------------------------------------------------------------------
  switch (currentState) {
    case STATE_READY: {
      // Continuously check for new RFID Smart Cards
      if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
        String uid = "";
        for (byte i = 0; i < mfrc522.uid.size; i++) {
          if (mfrc522.uid.uidByte[i] < 0x10) uid += "0";
          uid += String(mfrc522.uid.uidByte[i], HEX);
        }
        uid.toUpperCase();

        // Check 2-second debounce
        if (uid != lastScannedUid || (now - lastRfidScanTime) >= RFID_DEBOUNCE_MS) {
          lastScannedUid = uid;
          lastRfidScanTime = now;
          currentState = STATE_CARD_DETECTED;

          // Quick acknowledge card tap beep
          beepBuzzer(70, 1);

          updateLcd("CARD IDENTIFIED:", uid);
          sendSerialRfid(uid);
        }

        mfrc522.PICC_HaltA();
        mfrc522.PCD_StopCrypto1();
      }
      break;
    }

    case STATE_CARD_DETECTED: {
      // Idle while user enters PIN on web portal; if 15 seconds pass without dispense, reset
      if (now - lastRfidScanTime > 15000) {
        currentState = STATE_READY;
        setLedStatus(true, false, false); // Return to Blue (scanning mode)
        updateLcd("NAMMAPANGU", "READY TO SCAN...");
      }
      break;
    }

    case STATE_DISPENSING: {
      handleDispenseLoop();
      break;
    }

    case STATE_COMPLETED: {
      // Hold completed confirmation on LCD for 3 seconds then return to READY
      delay(3000);
      currentState = STATE_READY;
      setLed(true);
      setLedStatus(true, false, false); // Blue ON: Ready for next smart card scan
      updateLcd("NAMMAPANGU", "READY TO SCAN...");
      sendSerialStatus("READY");
      break;
    }

    case STATE_STOPPED: {
      // Held in stopped state until SCAN or TARE command resets it
      break;
    }

    default:
      break;
  }

  delay(10); // Yield to FreeRTOS background watchdog
}

// ====================================================================================
// 5. AUTOMATED LOAD CELL DISPENSING ENGINE
// ====================================================================================
void startDispense(float targetKg) {
  if (targetKg <= 0.05f) {
    sendSerialError("INVALID_TARGET_WEIGHT");
    return;
  }

  targetDispenseKg = targetKg;
  currentState = STATE_DISPENSING;
  dispenseStartTime = millis();
  lastWeightStreamTime = millis();

  // GREEN LED ON while dispensing / purchasing components
  setLedStatus(false, true, false);
  beepBuzzer(80, 1); // Short dispense start tone

  // 1. Tare the load cell before dispensing to zero out container weight
  tareScale();

  // 2. Open mechanical servo gate
  openServoGate();

  // 3. Update LCD
  updateLcd("DISPENSING...", "TARGET: " + String(targetKg, 2) + " KG");
  sendSerialStatus("DISPENSING");
}

void handleDispenseLoop() {
  unsigned long now = millis();

  // Read current weight from HX711
  liveWeightKg = readWeightKg(1);

  // Blink Aux Status LED while dispensing is active; Green LED stays solidly ON
  setLed((now / 200) % 2 == 0);

  // Periodically stream live weight telemetry to Dashboard and LCD
  if (now - lastWeightStreamTime >= WEIGHT_STREAM_INTERVAL) {
    lastWeightStreamTime = now;
    sendSerialWeight(liveWeightKg, false);
    updateLcd("DISPENSING...", "WT: " + String(liveWeightKg, 2) + "/" + String(targetDispenseKg, 2) + "K");
  }

  // Check if target weight is achieved
  if (liveWeightKg >= targetDispenseKg) {
    // 1. Close dispenser gate immediately!
    closeServoGate();

    // 2. Wait for mechanical settling
    delay(350);

    // 3. Confirm final stable weight
    float confirmedWeight = 0.0f;
    int checks = 0;
    while (!isWeightStable(confirmedWeight) && checks < 8) {
      delay(40);
      checks++;
    }
    if (confirmedWeight <= 0.005f) {
      confirmedWeight = readWeightKg(3);
    }

    // 4. Update UI and report back to Firestore
    setLed(true); // Solid ON
    setLedStatus(false, true, false); // Green LED solid ON (Dispensed!)
    beepBuzzer(140, 2, 70); // Double success chime/beep
    updateLcd("DISPENSED!", "FINAL: " + String(confirmedWeight, 2) + " KG");
    sendSerialWeight(confirmedWeight, true);
    sendSerialStatus("COMPLETED");

    currentState = STATE_COMPLETED;
    return;
  }

  // 30-Second Emergency Safety Timeout
  if (now - dispenseStartTime > DISPENSE_SAFETY_TIMEOUT) {
    closeServoGate();
    setLed(false);
    setLedStatus(false, false, true); // RED LED ON on safety timeout
    beepBuzzer(250, 3, 80);           // 3 error beeps
    updateLcd("SAFETY TIMEOUT", "GATE SHUT OFF");
    sendSerialError("DISPENSE_TIMEOUT_SAFETY_CUTOFF");
    currentState = STATE_STOPPED;
  }
}

void emergencyStop() {
  closeServoGate();
  setLed(false);
  setLedStatus(false, false, true); // RED LED ON on emergency stop
  beepBuzzer(250, 3, 80);           // 3 error beeps
  currentState = STATE_STOPPED;
  updateLcd("EMERGENCY STOP", "GATE CLOSED");
  sendSerialStatus("STOPPED");
}

// ====================================================================================
// 6. HARDWARE CONTROL PRIMITIVES
// ====================================================================================
void setLedStatus(bool blue, bool green, bool red) {
  digitalWrite(LED_BLUE_PIN, blue ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, green ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, red ? HIGH : LOW);
}

void beepBuzzer(int durationMs, int count, int pauseMs) {
  for (int i = 0; i < count; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < count - 1) {
      delay(pauseMs);
    }
  }
}

void setLed(bool on) {
  digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
}

void setLedBlink(int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(delayMs);
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(delayMs);
  }
}

void openServoGate() {
  dispenserServo.write(SERVO_OPEN_ANGLE);
  isGateOpen = true;
  delay(150);
  sendSerialServo("OPEN");
}

void closeServoGate() {
  dispenserServo.write(SERVO_CLOSED_ANGLE);
  isGateOpen = false;
  delay(150);
  sendSerialServo("CLOSED");
}

void tareScale() {
  if (scale.is_ready()) {
    scale.tare();
  }
  liveWeightKg = 0.0f;
  sendSerialWeight(0.00, true);
  sendSerialStatus("TARED");
}

float readWeightKg(int samples) {
  if (!scale.is_ready()) {
    return liveWeightKg;
  }
  float w = scale.get_units(samples);
  if (w < 0.005f) w = 0.0f; // Zero noise floor clamp
  return w;
}

bool isWeightStable(float &stableWeight) {
  if (!scale.is_ready()) return false;
  float r1 = scale.get_units(1);
  delay(15);
  float r2 = scale.get_units(1);
  delay(15);
  float r3 = scale.get_units(1);

  if (abs(r1 - r2) < 0.02f && abs(r2 - r3) < 0.02f) {
    stableWeight = (r1 + r2 + r3) / 3.0f;
    if (stableWeight < 0.005f) stableWeight = 0.0f;
    return true;
  }
  return false;
}

void updateLcd(const String &line1, const String &line2) {
  static String prevLine1 = "";
  static String prevLine2 = "";

  if (line1 == prevLine1 && line2 == prevLine2) return;
  prevLine1 = line1;
  prevLine2 = line2;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, LCD_COLUMNS));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, LCD_COLUMNS));
}

// ====================================================================================
// 7. SERIAL COMMAND PARSER & JSON PROTOCOL (Browser Web Serial <-> ESP32)
// ====================================================================================
/**
 * Robust JSON and plain text command parser that works reliably without external library dependencies
 */
void processIncomingSerialLine(const String &line) {
  String upper = line;
  upper.toUpperCase();

  // 1. TARE COMMAND
  if (upper.indexOf("TARE") >= 0) {
    tareScale();
    updateLcd("SCALE ZEROED", "TARE COMPLETED");
    return;
  }

  // 2. STOP / EMERGENCY COMMAND
  if (upper.indexOf("STOP") >= 0) {
    emergencyStop();
    return;
  }

  // 3. SCAN COMMAND (Arm Scanner / Blue LED ON)
  if (upper.indexOf("SCAN") >= 0) {
    currentState = STATE_READY;
    setLed(true);
    setLedStatus(true, false, false); // BLUE LED ON: Scanner is active
    updateLcd("NAMMAPANGU", "READY TO SCAN...");
    sendSerialStatus("READY");
    return;
  }

  // 4. USER VALID COMMAND (User Registered: Green LED ON + 2 Confirmation Beeps)
  if (upper.indexOf("USER_VALID") >= 0) {
    setLedStatus(false, true, false); // GREEN LED ON, BLUE & RED OFF
    beepBuzzer(80, 2, 60);            // 2 quick pleasant confirmation beeps
    updateLcd("CITIZEN VERIFIED", "ENTER 6-DIGIT PIN");
    return;
  }

  // 5. USER INVALID COMMAND (User Not Registered: Red LED ON + Warning Beeps)
  if (upper.indexOf("USER_INVALID") >= 0) {
    setLedStatus(false, false, true); // RED LED ON, BLUE & GREEN OFF
    beepBuzzer(240, 2, 100);          // 2 warning alert beeps
    updateLcd("NOT REGISTERED", "PLEASE ENROLL");
    return;
  }

  // 6. REGISTERING COMMAND (User Enrolling: Green LED ON)
  if (upper.indexOf("REGISTERING") >= 0) {
    setLedStatus(false, true, false); // GREEN LED ON while registering
    updateLcd("ENROLLING CARD", "ENTER DETAILS...");
    return;
  }

  // 7. BUZZER COMMAND
  if (upper.indexOf("BUZZER") >= 0) {
    beepBuzzer(100, 1);
    return;
  }

  // 8. DIRECT LED COLOR COMMANDS
  if (upper.indexOf("LED_BLUE") >= 0) {
    setLedStatus(true, false, false);
    return;
  }
  if (upper.indexOf("LED_GREEN") >= 0) {
    setLedStatus(false, true, false);
    return;
  }
  if (upper.indexOf("LED_RED") >= 0) {
    setLedStatus(false, false, true);
    return;
  }

  // 9. DISPENSE COMMAND: e.g. {"command":"DISPENSE","target":1.5} or "DISPENSE 1.5"
  if (upper.indexOf("DISPENSE") >= 0) {
    float target = 1.0f; // Default 1.0 KG

    // Try extracting target float from JSON string: "target":1.5
    int targetIdx = upper.indexOf("\"TARGET\"");
    if (targetIdx >= 0) {
      int colonIdx = upper.indexOf(":", targetIdx);
      if (colonIdx >= 0) {
        String numStr = "";
        for (int i = colonIdx + 1; i < (int)upper.length(); i++) {
          char ch = upper.charAt(i);
          if ((ch >= '0' && ch <= '9') || ch == '.') {
            numStr += ch;
          } else if (numStr.length() > 0) {
            break;
          }
        }
        if (numStr.length() > 0) {
          target = numStr.toFloat();
        }
      }
    } else {
      // Plain text fallback: "DISPENSE 2.0"
      int spaceIdx = upper.indexOf(" ");
      if (spaceIdx >= 0) {
        target = upper.substring(spaceIdx + 1).toFloat();
      }
    }

    if (target > 0.05f) {
      startDispense(target);
    } else {
      sendSerialError("INVALID_TARGET_WEIGHT");
    }
    return;
  }

  sendSerialError("UNKNOWN_COMMAND");
}

// ====================================================================================
// 8. OUTGOING JSON FORMATTERS
// ====================================================================================
void sendSerialRfid(const String &uid) {
  Serial.print(F("{\"type\":\"RFID\",\"uid\":\""));
  Serial.print(uid);
  Serial.println(F("\"}"));
}

void sendSerialWeight(float weightKg, bool stable) {
  Serial.print(F("{\"type\":\"WEIGHT\",\"value\":"));
  Serial.print(weightKg, 2);
  Serial.print(F(",\"unit\":\"kg\",\"stable\":"));
  Serial.print(stable ? F("true") : F("false"));
  Serial.println(F("}"));
}

void sendSerialServo(const String &state) {
  Serial.print(F("{\"type\":\"SERVO\",\"state\":\""));
  Serial.print(state);
  Serial.println(F("\"}"));
}

void sendSerialStatus(const String &state) {
  Serial.print(F("{\"type\":\"STATUS\",\"state\":\""));
  Serial.print(state);
  Serial.println(F("\"}"));
}

void sendSerialError(const String &message) {
  Serial.print(F("{\"type\":\"ERROR\",\"message\":\""));
  Serial.print(message);
  Serial.println(F("\"}"));
}

void sendSerialHeartbeat() {
  Serial.print(F("{\"type\":\"HEARTBEAT\",\"uptime\":"));
  Serial.print(millis() / 1000);
  Serial.print(F(",\"state\":\""));
  switch (currentState) {
    case STATE_READY: Serial.print(F("READY")); break;
    case STATE_CARD_DETECTED: Serial.print(F("CARD_DETECTED")); break;
    case STATE_DISPENSING: Serial.print(F("DISPENSING")); break;
    case STATE_COMPLETED: Serial.print(F("COMPLETED")); break;
    case STATE_STOPPED: Serial.print(F("STOPPED")); break;
    default: Serial.print(F("BOOTING")); break;
  }
  Serial.println(F("\"}"));
}

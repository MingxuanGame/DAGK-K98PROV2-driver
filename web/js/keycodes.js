/*
 * keycodes.js — HID usage tables + the vendor app's 4-byte key encoding
 *
 * A key position in the 512-byte matrix is 4 bytes.  Decoding rule taken
 * verbatim from the vendor bundle (matrixToHid / hidToMatrix):
 *   [0,0,x,0]            -> HID usage x                       (normal keys)
 *   anything else        -> (b0<<24)|(b1<<16)|(b2<<8)|b3      (media / special)
 * The vendor app stores consumer-page keys as [0, page, usage, 0],
 * e.g. [0,3,233,0] = Volume Up  -> packed 0x03E900.
 */

export function matrixToHid(cfg) {
  if (cfg[0] === 0 && cfg[1] === 0 && cfg[3] === 0) return cfg[2];
  return ((cfg[0] << 24) | (cfg[1] << 16) | (cfg[2] << 8) | cfg[3]) >>> 0;
}

export function hidToMatrix(hid) {
  if (hid <= 255) return [0, 0, hid, 0];
  return [(hid >>> 24) & 255, (hid >>> 16) & 255, (hid >>> 8) & 255, hid & 255];
}

/** USB HID Usage ID (page 0x07 keyboard) -> label */
export const HID_NAMES = {
  0x00: '无', 0x04: 'A', 0x05: 'B', 0x06: 'C', 0x07: 'D', 0x08: 'E', 0x09: 'F', 0x0a: 'G',
  0x0b: 'H', 0x0c: 'I', 0x0d: 'J', 0x0e: 'K', 0x0f: 'L', 0x10: 'M', 0x11: 'N', 0x12: 'O',
  0x13: 'P', 0x14: 'Q', 0x15: 'R', 0x16: 'S', 0x17: 'T', 0x18: 'U', 0x19: 'V', 0x1a: 'W',
  0x1b: 'X', 0x1c: 'Y', 0x1d: 'Z', 0x1e: '1', 0x1f: '2', 0x20: '3', 0x21: '4', 0x22: '5',
  0x23: '6', 0x24: '7', 0x25: '8', 0x26: '9', 0x27: '0', 0x28: 'Enter', 0x29: 'Esc',
  0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space', 0x2d: '-', 0x2e: '=', 0x2f: '[', 0x30: ']',
  0x31: '\\', 0x32: '#', 0x33: ';', 0x34: "'", 0x35: '`', 0x36: ',', 0x37: '.', 0x38: '/',
  0x39: 'CapsLock', 0x3a: 'F1', 0x3b: 'F2', 0x3c: 'F3', 0x3d: 'F4', 0x3e: 'F5', 0x3f: 'F6',
  0x40: 'F7', 0x41: 'F8', 0x42: 'F9', 0x43: 'F10', 0x44: 'F11', 0x45: 'F12',
  0x46: 'PrtSc', 0x47: 'ScrollLock', 0x48: 'Pause', 0x49: 'Insert', 0x4a: 'Home',
  0x4b: 'PageUp', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'PageDown', 0x4f: 'Right',
  0x50: 'Left', 0x51: 'Down', 0x52: 'Up', 0x53: 'NumLock', 0x54: 'KP /', 0x55: 'KP *',
  0x56: 'KP -', 0x57: 'KP +', 0x58: 'KP Enter', 0x59: 'KP 1', 0x5a: 'KP 2', 0x5b: 'KP 3',
  0x5c: 'KP 4', 0x5d: 'KP 5', 0x5e: 'KP 6', 0x5f: 'KP 7', 0x60: 'KP 8', 0x61: 'KP 9',
  0x62: 'KP 0', 0x63: 'KP .', 0x64: '\\ (ISO)', 0x65: 'App', 0x66: 'Power', 0x67: 'KP =',
  0x68: 'F13', 0x69: 'F14', 0x6a: 'F15', 0x6b: 'F16', 0x6c: 'F17', 0x6d: 'F18', 0x6e: 'F19',
  0x6f: 'F20', 0x70: 'F21', 0x71: 'F22', 0x72: 'F23', 0x73: 'F24',
  0x74: 'Execute', 0x75: 'Help', 0x76: 'Menu', 0x77: 'Select', 0x78: 'Stop', 0x79: 'Again',
  0x7a: 'Undo', 0x7b: 'Cut', 0x7c: 'Copy', 0x7d: 'Paste', 0x7e: 'Find', 0x7f: 'Mute',
  0x80: 'VolumeUp', 0x81: 'VolumeDown', 0x85: 'KP ,', 0x87: 'Intl1', 0x88: 'Intl2',
  0x89: 'Intl3', 0x8a: 'Intl4', 0x8b: 'Intl5', 0x8c: 'Intl6', 0x8d: 'Intl7', 0x8e: 'Intl8',
  0x8f: 'Intl9', 0x90: 'Lang1', 0x91: 'Lang2', 0x92: 'Lang3', 0x93: 'Lang4', 0x94: 'Lang5',
  0xe0: 'LCtrl', 0xe1: 'LShift', 0xe2: 'LAlt', 0xe3: 'LWin', 0xe4: 'RCtrl', 0xe5: 'RShift',
  0xe6: 'RAlt', 0xe7: 'RWin',
};

/** Consumer page (0x0C) usages the vendor app packs into [0,3,usage,0]. */
export const CONSUMER_NAMES = {
  0x30: 'Power', 0x31: 'Reset', 0x32: 'Sleep', 0x34: 'SleepMode', 0x38: 'DisplayOff',
  0x40: 'Menu', 0x41: 'MenuPick', 0x42: 'MenuUp', 0x43: 'MenuDown', 0x44: 'MenuLeft',
  0x45: 'MenuRight', 0x46: 'MenuEscape', 0x60: 'Info', 0x61: 'ClosedCaption',
  0x6f: 'BrightnessUp', 0x70: 'BrightnessDown', 0x8a: 'MediaSelect', 0xb0: 'Play',
  0xb1: 'Pause', 0xb2: 'Record', 0xb3: 'FastForward', 0xb4: 'Rewind', 0xb5: 'ScanNext',
  0xb6: 'ScanPrev', 0xb7: 'Stop', 0xb8: 'Eject', 0xcd: 'PlayPause', 0xe2: 'Mute',
  0xe9: 'VolumeUp', 0xea: 'VolumeDown', 0x183: 'MediaPlayer', 0x192: 'Calculator',
  0x194: 'MyComputer', 0x196: 'WWW', 0x199: 'WWWSearch', 0x19a: 'WWWHome', 0x19c: 'Email',
  0x1a6: 'WWWFavorites', 0x221: 'WWWBack', 0x223: 'WWWForward', 0x224: 'WWWStop',
  0x225: 'WWWRefresh', 0x22a: 'WWWBookmarks', 0x279: 'ScreenLock',
};

export const MOUSE_BUTTONS = {
  Left: 0, Right: 1, Middle: 2, Back: 3, Forward: 4,
};

/** label for any packed HID value */
export function keyLabel(hid) {
  if (hid === undefined || hid === null) return '—';
  if (hid <= 0xff) return HID_NAMES[hid] || ('HID 0x' + hid.toString(16).padStart(2, '0').toUpperCase());
  const b0 = (hid >>> 24) & 0xff, b1 = (hid >>> 16) & 0xff, b2 = (hid >>> 8) & 0xff;
  if (b0 === 0 && b1 === 0) return HID_NAMES[b2] || ('0x' + hid.toString(16).toUpperCase());
  // consumer page keys are stored as [3, 0, usage, 0]  -> packed 0x0300uu00
  if (b0 === 3) return CONSUMER_NAMES[b2] || ('Consumer 0x' + b2.toString(16).toUpperCase());
  if (b0 === 1) return 'Mouse ' + (Object.keys(MOUSE_BUTTONS).find((k) => MOUSE_BUTTONS[k] === b2) || b2);
  return '0x' + hid.toString(16).padStart(8, '0').toUpperCase();
}

/** Convert a 4-byte cell into a human readable description. */
export function describeCell(cfg) {
  const b = Array.from(cfg);
  if (b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0) return '禁用';
  if (b[0] === 9) {
    const t = ['重复次数', '开关', '按住重复'][b[1]] || '宏';
    return `宏${b[2]} (${t})`;
  }
  if (b[0] === 1) return '鼠标 ' + b[2];
  if (b[0] === 3) return keyLabel(matrixToHid(cfg));
  if (b[0] === 0 && (b[1] !== 0 || b[3] !== 0)) return '组合键 ' + b[1] + '/' + b[2] + '/' + b[3];
  if (b[0] === 24) return `MT ${keyLabel(b[1])}/${keyLabel(b[2])} ${b[3] * 10}ms`;
  if (b[0] === 22) return 'Snap ' + b[1];
  if (b[0] === 23) return 'MDS ' + b[1];
  if (b[0] === 21) return '手柄 ' + b[1];
  return keyLabel(matrixToHid(cfg));
}

/** Key choices offered by the editor (HID name -> usage id). */
export const QUICK_KEYS = [
  'Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'PrtSc', 'ScrollLock', 'Pause', 'Insert', 'Home', 'PageUp', 'Delete', 'End', 'PageDown',
  'Up', 'Down', 'Left', 'Right', 'NumLock', 'KP /', 'KP *', 'KP -', 'KP +', 'KP Enter',
  'KP 0', 'KP 1', 'KP 2', 'KP 3', 'KP 4', 'KP 5', 'KP 6', 'KP 7', 'KP 8', 'KP 9', 'KP .',
  'LCtrl', 'LShift', 'LAlt', 'LWin', 'RCtrl', 'RShift', 'RAlt', 'RWin', 'App', 'Menu',
];

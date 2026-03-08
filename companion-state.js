// Per-user state for companion mode — persisted to JSON file so restarts don't lose context
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dir, 'companion-state.json');

// Load persisted state on startup
let users;
try {
  const raw = readFileSync(STATE_FILE, 'utf8');
  users = new Map(Object.entries(JSON.parse(raw)));
} catch {
  users = new Map();
}

// Debounced write — batch saves within 2 seconds
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(users)), 'utf8');
    } catch {}
  }, 2000);
}

const DEFAULT_STATE = () => ({
  mode: 'normal',
  setupStep: 'choose_persona',
  persona: null,
  relationship: 'stranger',
  emotionalArc: 'tsundere',
  history: [],
});

export function getUser(openid) {
  if (!users.has(openid)) users.set(openid, DEFAULT_STATE());
  return users.get(openid);
}

export function setUserMode(openid, mode) {
  getUser(openid).mode = mode;
  scheduleSave();
}

export function setSetupStep(openid, step) {
  getUser(openid).setupStep = step;
  scheduleSave();
}

export function setPersona(openid, persona) {
  getUser(openid).persona = persona;
  scheduleSave();
}

export function setRelationship(openid, relationship) {
  getUser(openid).relationship = relationship;
  scheduleSave();
}

export function setEmotionalArc(openid, arc) {
  getUser(openid).emotionalArc = arc;
  scheduleSave();
}

// Strip [SEND_IMAGE/VIDEO: ...] tags from content before storing
function stripMediaTags(content) {
  return content.replace(/\[SEND_(IMAGE|VIDEO):[^\]]*\]/g, '').trim();
}

export function addHistory(openid, role, content) {
  const u = getUser(openid);
  u.history.push({ role, content: stripMediaTags(content) });
  if (u.history.length > 30) u.history.splice(0, u.history.length - 30);
  scheduleSave();
}

export function resetUser(openid) {
  users.set(openid, DEFAULT_STATE());
  scheduleSave();
}

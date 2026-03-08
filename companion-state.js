// In-memory per-user state for companion mode
const users = new Map();

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
}

export function setSetupStep(openid, step) {
  getUser(openid).setupStep = step;
}

export function setPersona(openid, persona) {
  getUser(openid).persona = persona;
}

export function setRelationship(openid, relationship) {
  getUser(openid).relationship = relationship;
}

export function setEmotionalArc(openid, arc) {
  getUser(openid).emotionalArc = arc;
}

// Strip [SEND_IMAGE/VIDEO: ...] tags from content before storing
function stripMediaTags(content) {
  return content.replace(/\[SEND_(IMAGE|VIDEO):[^\]]*\]/g, '').trim();
}

export function addHistory(openid, role, content) {
  const u = getUser(openid);
  u.history.push({ role, content: stripMediaTags(content) });
  if (u.history.length > 30) u.history.splice(0, u.history.length - 30);
}

export function resetUser(openid) {
  users.set(openid, DEFAULT_STATE());
}

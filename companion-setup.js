import { PERSONAS } from './companion-personas.js';
import {
  getUser, setSetupStep, setPersona, setRelationship, setEmotionalArc
} from './companion-state.js';

const PERSONA_PROMPT = `你好！我是你的专属陪伴，先来认识一下吧～

请选择你的陪伴：
【女生】
1. 冰山美人（高冷，慢热，偶尔嘴硬）
2. 活泼少女（开朗，爱撒娇，情绪外露）
3. 神秘精灵（捉摸不透，偶尔腹黑）
【男生】
4. 冷峻总裁（话少，城府深，实则在乎）
5. 温柔学长（体贴，总在需要时出现）
6. 神秘浪子（不羁，偶尔说出惊人深情话）
【自定义】
7. 文字描述（告诉我ta的名字、外貌和性格）
8. 发一张喜欢的人的照片，我来扮演ta`;

const CUSTOM_DESC_PROMPT = `请用一句话描述你的专属陪伴～

格式随意，例如：
・叫阿强，黑色短发，高冷但内心温柔
・一个叫晨曦的温柔女生，长发，爱笑
・叫凯文，金发蓝眼，帅气健谈

直接发给我就好～`;

const RELATIONSHIP_PROMPT = `请选择我们的关系：
1. 陌生人（需要你主动，我不会主动搭话）
2. 旧识（有点熟但有隔阂，需要重新拉近）
3. 青梅竹马（熟悉，但谁都没说出那句话）
默认：1（陌生人）`;

const ARC_PROMPT = `这段感情是什么风格？
1. 傲娇线（嘴硬心软，被哄了会融化）
2. 温柔线（温和体贴，逐渐依赖你）
3. 腹黑线（表面平静，内心戏很多）
默认：1（傲娇线）`;

const RELATIONSHIP_MAP = { '1': 'stranger', '2': 'old_friend', '3': 'childhood' };
const ARC_MAP = { '1': 'tsundere', '2': 'gentle', '3': 'scheming' };

// Parse "叫X，外貌描述，性格描述" from free-form text
function parseCustomDesc(text) {
  const nameMatch = text.match(/(?:叫|名字(?:叫)?|我叫|她叫|他叫)\s*([^\s，,。！？\n]{1,8})/);
  const name = nameMatch ? nameMatch[1] : 'ta';
  return {
    name,
    personality: text,
    refImageUrl: '',
    refDescription: text,
  };
}

// Returns true if user is still in setup (caller should not proceed to chat)
export async function handleSetupStep(openid, msgId, text, sendFn) {
  const u = getUser(openid);
  const choice = text.trim();

  if (u.setupStep === 'choose_persona') {
    return handlePersonaChoice(openid, msgId, choice, sendFn);
  }
  if (u.setupStep === 'awaiting_desc') {
    return handleCustomDesc(openid, msgId, choice, sendFn);
  }
  if (u.setupStep === 'awaiting_image') {
    return handleCustomImage(openid, msgId, choice, sendFn);
  }
  if (u.setupStep === 'choose_relationship') {
    const rel = RELATIONSHIP_MAP[choice] || 'stranger';
    setRelationship(openid, rel);
    setSetupStep(openid, 'choose_arc');
    await sendFn(openid, msgId, ARC_PROMPT);
    return true;
  }
  if (u.setupStep === 'choose_arc') {
    const arc = ARC_MAP[choice] || 'tsundere';
    setEmotionalArc(openid, arc);
    setSetupStep(openid, 'done');
    const persona = getUser(openid).persona;
    await sendFn(openid, msgId, `好的！${persona.name} 已准备好陪伴你了～`);
    return true;
  }
  return false; // setup done, proceed to chat
}

async function handlePersonaChoice(openid, msgId, choice, sendFn) {
  if (choice === '7') {
    setSetupStep(openid, 'awaiting_desc');
    await sendFn(openid, msgId, CUSTOM_DESC_PROMPT);
    return true;
  }
  if (choice === '8') {
    setSetupStep(openid, 'awaiting_image');
    await sendFn(openid, msgId, '请发送一张你喜欢的人的照片，我会以ta的形象陪伴你～');
    return true;
  }
  const idx = parseInt(choice, 10) - 1;
  const preset = PERSONAS[idx >= 0 && idx < PERSONAS.length ? idx : 0];
  setPersona(openid, {
    name: preset.name,
    personality: preset.personality,
    refImageUrl: preset.refImageUrl,
    refDescription: preset.refDescription,
  });
  setSetupStep(openid, 'choose_relationship');
  await sendFn(openid, msgId, RELATIONSHIP_PROMPT);
  return true;
}

async function handleCustomDesc(openid, msgId, desc, sendFn) {
  const persona = parseCustomDesc(desc);
  setPersona(openid, persona);
  setSetupStep(openid, 'choose_relationship');
  await sendFn(openid, msgId, `好的！我已经记住了～\n\n${RELATIONSHIP_PROMPT}`);
  return true;
}

async function handleCustomImage(openid, msgId, imageUrl, sendFn) {
  setPersona(openid, {
    name: 'ta',
    personality: '神秘而温柔，性格随对话自然演化',
    refImageUrl: imageUrl,
    refDescription: '按你上传的照片外貌',
  });
  setSetupStep(openid, 'choose_relationship');
  await sendFn(openid, msgId, RELATIONSHIP_PROMPT);
  return true;
}

// Send initial onboarding prompt to a new companion user
export async function sendOnboardingPrompt(openid, msgId, sendFn) {
  await sendFn(openid, msgId, PERSONA_PROMPT);
}

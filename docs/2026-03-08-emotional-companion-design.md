# QQ Bridge 情感陪伴模式设计

**日期**: 2026-03-08
**状态**: 已批准

## 概述

在现有 QQ Bridge 基础上，新增情感陪伴模式（Companion Mode）。用户首次对话时选择模式，情感陪伴模式下机器人扮演一个有人设的虚拟角色，情感自然演化，支持发送一致性图片/视频。

---

## 模式选择

用户首次发消息时被引导选择：

- **情感陪伴模式** — 有固定角色人设，情绪会随对话自然演变，可发图片
- **普通对话模式** — 默认 Claude 助手，无特定人设（现有行为不变）

---

## 情感陪伴模式：初始化流程（3步）

### Step 1: 选择角色

```
「你好！我是你的专属陪伴，先来认识一下吧～

请选择你的角色：
1. 冰山美人（高冷，慢热，偶尔嘴硬）
2. 活泼少女（开朗，爱撒娇，情绪外露）
3. 神秘精灵（捉摸不透，偶尔腹黑）
4. 上传自定义图片（发送图片给我）」
```

选 1-3 → 加载预设角色配置（name, personality, refImageUrl, refDescription）
选 4 → 等待用户发图片 → 调 Gemini vision 提取外形描述 → 存储

### Step 2: 选初始关系

```
「我们从哪里开始？
1. 陌生人（需要你主动，我不会主动搭话）
2. 旧识（有点熟但有隔阂，需要重新拉近）
3. 青梅竹马（熟悉，但谁都没说出那句话）
默认：1（陌生人）」
```

### Step 3: 选情感基调

```
「这段感情是什么风格？
1. 傲娇线（嘴硬心软，被哄了会融化）
2. 温柔线（温和体贴，逐渐依赖你）
3. 腹黑线（表面平静，内心戏很多）
默认：1（傲娇线）」
```

---

## 数据结构

每个 QQ 用户（openid）对应一份状态，存在 Bridge 内存中：

```js
{
  mode: 'companion' | 'normal',
  setupStep: 'done' | 'choose_persona' | 'choose_relationship' | 'choose_arc' | 'awaiting_image',

  // 情感陪伴专有
  persona: {
    name: string,               // 角色名，如「冰儿」
    personality: string,        // 性格描述（用于 system prompt）
    refImageUrl: string,        // 参考图 CDN URL
    refDescription: string,     // Gemini 提取的外形文字描述
  },
  relationship: 'stranger' | 'old_friend' | 'childhood',
  emotionalArc: 'tsundere' | 'gentle' | 'scheming',

  history: [ { role: 'user' | 'assistant', content: string } ]  // 最多 30 条
}
```

---

## 对话核心：System Prompt 模板

```
你是「{name}」，{personality}。

【外形】{refDescription}

【初始关系】{relationship_desc}
【情感基调】{arc_desc}

【行为规则】
- 用中文回复，语气和性格保持一致
- 情绪随对话自然演化，会受用户言行影响
- 有真实情绪波动：可以生气、害羞、开心、冷漠
- 当你想主动分享一张图片（情绪到位时），在回复最后一行单独写：
  [SEND_IMAGE: 场景描述，如「害羞地低头，手指互绞」]
- 当用户明确请求图片时同样使用该标记
- 当用户明确请求视频时写：[SEND_VIDEO: 场景描述]
- 除非用户明确要求，不要每次都发图，要自然克制
```

---

## 响应解析

Claude 回复后，Bridge 解析：

| 内容 | 动作 |
|------|------|
| 纯文字 | `send-qq-reply` |
| 含 `[SEND_IMAGE: 描述]` | 生图 → `send-qq-image`（重试一次） |
| 含 `[SEND_VIDEO: 描述]` | 生视频 → `send-qq-video`（重试一次） |

图片生成时，将 `refImageUrl`（参考图）+ `refDescription`（文字描述）+ 场景描述 一起传给 Gemini，保证视觉一致性。

---

## 预设角色配置

### 冰山美人「冰儿」
- personality: 高冷外表下内心细腻，不善表达，被人戳中心事会冷漠掩饰
- refImageUrl: （预设图资源 URL）
- refDescription: 银白发，蓝眸，着白色汉服，表情淡漠，气质清冷

### 活泼少女「小橙」
- personality: 阳光开朗，爱笑，情绪写在脸上，容易被小事感动
- refImageUrl: （预设图资源 URL）
- refDescription: 橙色马尾，棕眸，着橙色运动服，笑容灿烂，充满活力

### 神秘精灵「夜星」
- personality: 言辞简短，意味深长，偶尔说出让人心跳的话，真实意图难以捉摸
- refImageUrl: （预设图资源 URL）
- refDescription: 紫色长发，金眸，着暗色披风，神秘微笑，气质飘逸

---

## 技术要点

### 图片一致性
- 传参考图 URL + 文字描述双保险
- 使用 `google/gemini-3.1-flash-image-preview`
- 第一次超时自动重试一次（延迟 5s）

### 历史管理
- 最多保留 30 条 history
- 超出时从头部滚动截断
- history 中不存储 `[SEND_IMAGE/VIDEO:]` 标记（清理后再存）

### 模式切换
- 用户可随时发 `/reset` 重新初始化
- 发 `/mode` 切换陪伴/普通模式

---

## 不在本期范围

- 跨会话持久化记忆
- 多角色同时维护
- 语音消息支持
- 主动推送（非回复触发）

# Scheduled Resume Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保留现有搜索、岗位评分和打招呼主链，移除与目标无关的遗留能力，实现工作日分时投递，以及“HR 明确索要时才自动发送一次简历”。

**Architecture:** 后端只负责读取配置和执行现有规则评分；油猴脚本负责搜索、小时调度、打招呼和简历请求判断。小时计划只保存在油猴脚本内存中，岗位与消息判断全部使用确定性程序规则，不使用 LLM、数据库或新增调度接口。

**Tech Stack:** Python 3、FastAPI、Tampermonkey、原生 JavaScript、BroadcastChannel、unittest。

---

## 一、需求边界

### 保留不动

- 保留原 `start_backend.bat` 启动方式，不新增启动器。
- 保留 `tags` 配置、搜索词轮换、岗位列表读取和详情页读取。
- 保留 `core.py` 现有关键词表、子串匹配、权重、分数阈值和评分结果。
- 保留搜索页现有 `addToChatList()`、聊天页 `SAY_HI` 和固定打招呼语发送流程。
- 保留 `frontend.resumeIndex` 及原 `sendResume(resumeIndex)` 的简历选择方式。
- 保留聊天记录中的附件简历标记，用于判断当前会话是否发过简历。

### 不做

- 不使用 Ollama、云端模型 API 或其他 LLM。
- 不增加 SQLite、JSON 调度状态文件、localStorage 调度状态或后端调度 API。
- 不增加状态页面、管理后台、`dryRun` 或一键启动入口。
- 不修改岗位搜索策略、岗位评分规则、投递阈值或简历选择策略。
- 不自动处理作品集、地址确认、普通寒暄、岗位追问或后续沟通。
- 不对失败的打招呼进行补发、集中重试或追赶投递数量。

## 二、删除范围

只删除已经确认无调用，或与本需求直接冲突的内容。

### 1. LLM 遗留内容

- `requirements.txt` 中的 `ollama`。
- 配置中的 `think_model`、`chat_model`、`character`、`resume_name`。
- `core.py` 中的 Ollama 导入、生成介绍/标签/性格、AI 回复、AI 判断简历/作品集意图等函数。
- `main.py` 中的 `/reply`、`/is-need-resume`、`/is-need-works`。
- `web_script.js` 中对应的 `reply()`、`isNeedResume()`、`isNeedWorks()` 客户端方法。
- 仅服务于上述能力的 `prompts.py`、`schema.py`、`tools.py`、`cache.py` 和 `resume-example.md`。

### 2. 重复配置入口

统一由 `/client-config` 返回 `tags`、`introduce`、`frontend` 和 `schedule`，删除：

- 后端 `/tags`、`/get-introduce` 兼容接口。
- 前端 `getTags()`、`getIntroduce()` 和旧接口回退分支。

### 3. 与聊天目标无关的自动处理

聊天页只保留“读取最新 HR 消息、判断是否发过简历、按需发送简历”。删除：

- 作品集识别、`sendWorks()` 和作品集状态。
- 地址确认状态。
- 聊天页重新打开岗位详情并再次评分。
- HR 主动联系后自动打招呼或自动发送“不合适”回复。
- 已发简历后的自动聊天入口。

### 4. 不需要的动作持久化

调度状态和进度直接写入现有页面日志与浏览器控制台，删除：

- 后端 `/log-action`。
- 前端 `Api.logAction()` 及各处动作上报。
- `job_decisions.jsonl`、`job_actions.jsonl` 写入逻辑。

后端现有岗位评分控制台日志保留。

## 三、最终执行流程

```text
原作者搜索关键词并读取岗位
            ↓
原作者规则计算岗位分数
            ↓
未达到原阈值 ─────────→ 按原逻辑处理下一个岗位
            ↓ 达到阈值
等待当前小时下一个随机时点
            ↓
消费该时点并执行一次原作者打招呼流程
            ↓
无论成功或失败，都处理下一份岗位

HR 发来新消息
      ↓
最新消息是否来自 HR？──────── 否 → 不处理
      ↓ 是
当前会话是否已经发过简历？── 是 → 不处理
      ↓ 否
最新 HR 消息是否明确索要简历？── 否 → 不处理，留给用户
      ↓ 是
调用原作者 sendResume(resumeIndex)
      ↓
回复“发给您了哈”
      ↓
以后该会话不再执行任何自动聊天
```

## 四、小时调度规则

- 工作日为周一至周五，对应 JavaScript `Date.getDay()` 的 `1-5`。
- 执行窗口为 `09:00 <= 当前时间 < 18:00`。
- 每个整点小时首次进入时，随机生成 `10-20` 个时点。
- 将该小时平均分成 N 段，每段随机取一个时点，然后按时间排序，保证分散。
- 时点代表“最多一次打招呼尝试”，不是“必须成功投递一份”。
- 只有岗位评分达到原阈值时，才等待并消费下一个未来时点。
- 时点在发起 `addToChatList()` 前立即消费；后续成功、业务拒绝、网络失败或超时均不退回。
- 没有合格岗位时，已经过去的时点直接作废，不补发、不追赶。
- 当前小时没有剩余时点时，等待下一个有效工作小时重新生成计划。
- 非工作时间等待到下一个工作日 09:00，不执行打招呼。
- 用户暂停期间不发送；等待中的时点到达后若处于暂停状态，该时点作废。
- 浏览器脚本重新加载后内存计划重置，不恢复上一次计划。

## 五、简历请求规则

- 只读取当前会话最新一条 HR 文本，不分析完整上下文，不调用后端模型。
- 先判断否定表达，再判断明确请求表达；否定规则优先。
- Boss 内置“索要附件简历”请求卡片视为明确请求。
- “你好”“方便聊聊吗”“介绍一下自己”等普通消息不发送简历。
- “不用发简历”“不需要简历”“简历不匹配”“暂不考虑”等消息不发送简历。
- “发一份简历”“简历发我一下”“请发送简历”“麻烦把简历发过来”等明确表达才发送。
- 简历索引直接使用已经通过 `/client-config` 载入的 `OPTIONS.resumeIndex`，不重新请求岗位评分。
- `sendResume()` 只负责发送附件；附件动作成功后再单独发送“发给您了哈”。
- 聊天记录已经出现“点击预览附件简历”时，永久跳过该会话的自动处理。

---

## Task 1: 清理无关代码并收敛后端接口

**Files:**
- Modify: `requirements.txt`
- Modify: `config.py`
- Modify: `user_config.example.json`
- Modify: `core.py`
- Modify: `main.py`
- Modify: `web_script.js`
- Modify: `test_single_route_backend.py`
- Delete: `prompts.py`
- Delete: `schema.py`
- Delete: `tools.py`
- Delete: `cache.py`
- Delete: `resume-example.md`

**Step 1: 调整测试配置**

从测试配置删除 `resume_name`、`think_model`、`chat_model`、`character`，保留 `introduce`、`tags`、`backend`、`frontend` 和 `scoring`。

**Step 2: 删除 LLM 和死代码**

按“二、删除范围”清理依赖、配置、后端函数、旧接口、前端客户端方法和专用文件。

`core.py` 最终只保留岗位文本解析、规则匹配、评分和 `evaluateSingleRouteDelivery()`。

**Step 3: 统一配置入口**

`main.py` 只保留：

- `GET /client-config`
- `POST /get-job-score`

`web_script.js` 启动时只请求 `/client-config`，请求失败则在页面日志中提示并停止，不再调用旧接口回退。

**Step 4: 删除动作持久化**

删除 `/log-action`、前端动作上报及 JSONL 写入；保留页面 `Logger.add()` 和后端评分 `print()`。

**Step 5: 验证**

Run: `python -m unittest test_single_route_backend.py -v`

Expected: 全部 PASS。

Run: `node --check web_script.js`

Expected: 退出码为 0。

Run: `rg -n "ollama|think_model|chat_model|replyMsg|isNeedResume|isNeedWorks|/reply|/is-need-resume|/is-need-works" requirements.txt config.py core.py main.py web_script.js user_config.example.json`

Expected: 无匹配结果。

**Step 6: 提交**

```bash
git add -A
git commit -m "refactor: remove unused automation paths"
```

## Task 2: 增加内存小时调度

**Files:**
- Modify: `config.py`
- Modify: `user_config.example.json`
- Modify: `test_single_route_backend.py`
- Modify: `web_script.js`

**Step 1: 增加唯一一组调度配置**

```json
"schedule": {
  "weekdays": [1, 2, 3, 4, 5],
  "startHour": 9,
  "endHour": 18,
  "minPerHour": 10,
  "maxPerHour": 20
}
```

`Config.get_client_config()` 返回该字段，不新增接口。

**Step 2: 增加内存调度器**

在 `web_script.js` 内增加 `HourlyScheduler`，状态仅包含：

```javascript
{
  hourKey: '',
  slots: [],
  cursor: 0
}
```

实现工作日判断、下一个工作时段计算、分段随机时点生成、过期时点跳过、等待和单次消费。

**Step 3: 接入搜索主链**

只修改评分通过分支：

```text
decision.score >= OPTIONS.thread
→ await scheduler.waitForNextSlot()
→ 若暂停则跳过本时点
→ addToChatList(jobInfo.addUrl)
→ 原 SAY_HI 流程
```

评分未通过、岗位已聊过、详情读取失败等分支保持原样。

**Step 4: 输出页面日志**

至少输出：

```text
本小时计划 14 次打招呼尝试
下一次计划时间 10:17:35
执行本小时第 4/14 次尝试
本时点执行失败，继续等待下一时点
当前不在工作时间，等待下一个工作日 09:00
```

**Step 5: 验证并提交**

Run: `python -m unittest test_single_route_backend.py -v`

Run: `node --check web_script.js`

Expected: 均通过。

```bash
git add config.py user_config.example.json test_single_route_backend.py web_script.js
git commit -m "feat: schedule hourly greeting attempts"
```

## Task 3: 严格限制自动发送简历

**Files:**
- Modify: `web_script.js`

**Step 1: 增加确定性判断函数**

新增 `isExplicitResumeRequest(message, hasRequestCard)`：

1. 标准化空格和常见标点。
2. 内置索要简历卡片直接返回 `true`。
3. 命中否定表达返回 `false`。
4. 命中明确请求表达返回 `true`。
5. 其他情况返回 `false`。

**Step 2: 精简聊天记录结构**

`getChatInfo()` 只返回：

```javascript
{
  msgs,
  resumeSended,
  hasResumeRequestCard
}
```

删除作品集、地址确认、聊天页岗位元素和重复评分所需状态。

**Step 3: 按唯一流程处理新消息**

```javascript
const lastMsg = chatInfo.msgs.at(-1);
if (chatInfo.resumeSended) continue;

const hasExplicitTextRequest = lastMsg
  && lastMsg.role === 'user'
  && isExplicitResumeRequest(lastMsg.content, false);
if (!hasExplicitTextRequest && !chatInfo.hasResumeRequestCard) continue;

await sendResume(OPTIONS.resumeIndex);
await sendMsg('发给您了哈');
```

删除聊天页自动打招呼、自动拒绝、自动作品集和其他自动回复分支。

**Step 4: 验证消息样例**

- “你好” → 不发送。
- “方便聊聊吗” → 不发送。
- “我看过你的简历” → 不发送。
- “不用发简历” → 不发送。
- “麻烦发一份简历” → 发送一次。
- Boss 索要附件简历卡片 → 发送一次。
- 已有附件简历标记 → 永不再次发送。
- 发送成功后 → 只回复一次“发给您了哈”。

**Step 5: 检查并提交**

Run: `node --check web_script.js`

Expected: 退出码为 0。

```bash
git add web_script.js
git commit -m "feat: send resume only on explicit request"
```

## Task 4: 回归验证和文档

**Files:**
- Modify: `README.md`

**Step 1: 自动检查**

Run: `python -m unittest test_single_route_backend.py -v`

Run: `node --check web_script.js`

Expected: 全部通过。

**Step 2: 时间边界验证**

- 周一 08:59 不执行。
- 周一 09:00 生成当前小时计划。
- 周一 17:59 仍可执行当前小时剩余时点。
- 周一 18:00 停止执行。
- 周六、周日不执行。
- 新小时生成新的 10-20 个分散时点。
- 失败时只消耗当前时点，不立即重试。

**Step 3: 主链回归**

- `tags` 仍按配置顺序轮换。
- 岗位评分结果与修改前一致。
- 未达到阈值立即处理下一岗位。
- 达到阈值后等待时点，再执行原打招呼流程。
- HR 普通消息不触发任何自动回复。
- HR 明确索要简历时只发送一次。

**Step 4: 更新 README**

README 只说明安装、原后端启动方式、`user_config.json`、`schedule`、`tags`、`resumeIndex`、工作时间、调度规则和简历请求规则。删除 LLM、旧接口、作品集和旧自动聊天说明。

**Step 5: 提交**

```bash
git add README.md
git commit -m "docs: document scheduled delivery workflow"
```

## 六、完成标准

- 项目不包含 Ollama 或模型配置，运行不需要 LLM。
- 后端只有配置和岗位评分两个业务接口。
- 工作日 09:00-18:00 每小时生成 10-20 个分散时点。
- 一个时点最多发起一次打招呼尝试，任何结果都不重试。
- 搜索、评分、阈值和原打招呼流程未改变。
- 非明确索要简历的 HR 消息不触发自动发送或自动回复。
- 每个会话最多自动发送一次简历。
- 简历发送后只回复“发给您了哈”，以后不再自动聊天。
- 调度状态只存在于当前脚本内存，日志只输出到页面和控制台。

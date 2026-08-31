# Scheduled Resume Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在保留 Tampermonkey + FastAPI 架构的前提下，实现工作日 09:00-18:00 每小时生成 10-20 个随机投递时点，每次只处理一个岗位；仅在 HR 明确索要简历时发送指定简历并回复“发给您了哈”。

**Architecture:** Python 后端只增加小时计划、执行许可和会话状态；油猴脚本继续沿用作者原有的搜索、评分、筛选、打招呼和简历序号选择流程，只在原流程外增加时间门控。消息处理仅把“收到任意新消息即发送简历”改为严格分类，只有 `explicit_request` 才发送，其他消息不处理并留给人工。

**Tech Stack:** Python 3、FastAPI、Pydantic、SQLite（标准库）、Tampermonkey、原生 JavaScript、BroadcastChannel、unittest。

---

## 需求口径

- 默认时区：`Asia/Shanghai`。
- 默认工作日：周一至周五；法定节假日和调休先通过配置覆盖，不在首版接入外部日历。
- 执行窗口：`09:00 <= 当前时间 < 18:00`，即 9 个小时窗口。
- 每个小时开始时生成本小时目标数，闭区间 `[10, 20]`。
- 将目标数个时点随机分布在本小时剩余可用时间内；没有合适岗位时允许少投，不为凑数发送低匹配岗位。
- 默认启用 `dryRun`，正式发送必须显式关闭。
- 每个会话最多自动发送一次简历；发送后不再自动聊天。
- 保持作者现有的 `start_backend.bat` 启动方式，不增加一键启动器。
- 不修改 `core.py` 的岗位评分、关键词权重、投递阈值和岗位匹配策略。
- 不修改作者现有的搜索词轮换、岗位详情读取、招呼语和 `resumeIndex` 选取逻辑。
- 不新增验证码识别、浏览器反检测或平台限制绕过逻辑，沿用原项目现有异常处理。

## 方案比较

### 方案 A：后端计划 + 油猴执行（采用）

后端保存计划和计数，浏览器按执行许可处理单个岗位。改造范围可控，能复用现有 BOSS DOM 操作，并且重启后仍能恢复状态。

### 方案 B：全部调度放在油猴脚本

代码量较少，但后台标签页可能被冻结，刷新或浏览器重启后状态容易丢失，不适合小时级稳定调度。

### 方案 C：改为 Playwright 常驻服务（不采用）

需要重写现有页面操作和启动方式，超出“只改时间和简历发送条件”的范围。

## 状态模型

```text
小时计划: planned -> due -> claimed -> completed | skipped | paused

岗位动作: discovered -> scored -> greeted | rejected | failed

会话状态: new_reply -> explicit_request -> resume_sending
                               -> resume_sent -> handed_to_human
                         \-> ambiguous -> handed_to_human
                         \-> not_requested -> handed_to_human
```

## Task 1: 添加调度配置

**Files:**
- Modify: `config.py`
- Modify: `user_config.example.json`
- Modify: `test_single_route_backend.py`

**Step 1: 写失败测试**

增加测试，验证默认配置包含：

```python
self.assertEqual(Config.scheduler['timezone'], 'Asia/Shanghai')
self.assertEqual(Config.scheduler['startHour'], 9)
self.assertEqual(Config.scheduler['endHour'], 18)
self.assertEqual(Config.scheduler['minPerHour'], 10)
self.assertEqual(Config.scheduler['maxPerHour'], 20)
self.assertTrue(Config.scheduler['dryRun'])
```

**Step 2: 运行测试并确认失败**

Run: `python -m unittest test_single_route_backend.py -v`

Expected: FAIL，提示 `Config` 没有 `scheduler`。

**Step 3: 增加配置结构**

在默认配置和示例配置中加入：

```json
"scheduler": {
  "enabled": true,
  "timezone": "Asia/Shanghai",
  "weekdays": [1, 2, 3, 4, 5],
  "startHour": 9,
  "endHour": 18,
  "minPerHour": 10,
  "maxPerHour": 20,
  "minimumGapSeconds": 90,
  "pollIntervalSeconds": 15,
  "dryRun": true,
  "excludedDates": [],
  "includedDates": []
}
```

**Step 4: 运行测试并确认通过**

Run: `python -m unittest test_single_route_backend.py -v`

Expected: PASS。

**Step 5: 提交**

```bash
git add config.py user_config.example.json test_single_route_backend.py
git commit -m "feat: add scheduled delivery configuration"
```

## Task 2: 实现可复现的小时计划生成器

**Files:**
- Create: `scheduler.py`
- Create: `test_scheduler.py`

**Step 1: 写失败测试**

覆盖以下行为：

- 周末不生成计划。
- 09:00 前和 18:00 后不允许领取任务。
- 每小时目标数始终位于 10-20。
- 所有计划时点都位于当前小时内。
- 时点严格递增，并满足最小间隔。
- 同一个 `hour_key + seed` 生成相同计划。
- 当前小时已过去一部分时，只在剩余时间内排期。

测试通过注入 `now` 和 `random.Random(seed)`，不依赖系统真实时间。

**Step 2: 运行测试并确认失败**

Run: `python -m unittest test_scheduler.py -v`

Expected: FAIL，提示 `scheduler` 模块不存在。

**Step 3: 实现领域对象**

```python
@dataclass(frozen=True)
class HourlyPlan:
    hour_key: str
    target_count: int
    scheduled_at: tuple[datetime, ...]

def build_hourly_plan(now: datetime, config: dict, rng: random.Random) -> HourlyPlan | None:
    ...

def is_working_time(now: datetime, config: dict) -> bool:
    ...
```

计划生成只负责时间，不接触 BOSS 页面，也不承诺一定凑满目标数。

**Step 4: 运行测试并确认通过**

Run: `python -m unittest test_scheduler.py -v`

Expected: PASS。

**Step 5: 提交**

```bash
git add scheduler.py test_scheduler.py
git commit -m "feat: generate hourly delivery plans"
```

## Task 3: 使用 SQLite 持久化计划和执行许可

**Files:**
- Create: `storage.py`
- Create: `test_storage.py`
- Modify: `.gitignore`

**Step 1: 写失败测试**

覆盖以下行为：

- 同一小时只能创建一份计划。
- 一个计划时点只能被领取一次。
- 浏览器重复请求不会重复增加完成数。
- 重启并重新打开数据库后状态仍存在。

**Step 2: 运行测试并确认失败**

Run: `python -m unittest test_storage.py -v`

Expected: FAIL，提示 `storage` 模块不存在。

**Step 3: 创建最小数据表**

```sql
CREATE TABLE hourly_plans (
  hour_key TEXT PRIMARY KEY,
  target_count INTEGER NOT NULL,
  scheduled_json TEXT NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dispatch_claims (
  claim_id TEXT PRIMARY KEY,
  hour_key TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE conversations (
  conversation_key TEXT PRIMARY KEY,
  last_hr_message_hash TEXT,
  resume_status TEXT NOT NULL DEFAULT 'not_sent',
  handed_to_human INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
```

数据库文件使用 `runtime/goodjob.db`，并加入 `.gitignore`。

**Step 4: 使用事务领取许可**

领取操作使用 `BEGIN IMMEDIATE`，确保多个标签页同时轮询时只有一个能拿到许可。

**Step 5: 运行测试并确认通过**

Run: `python -m unittest test_storage.py -v`

Expected: PASS。

**Step 6: 提交**

```bash
git add storage.py test_storage.py .gitignore
git commit -m "feat: persist scheduler and conversation state"
```

## Task 4: 暴露调度 API

**Files:**
- Modify: `main.py`
- Create: `test_scheduler_api.py`

**Step 1: 写失败测试**

覆盖：

- `GET /scheduler/status` 返回当前小时目标、已完成、人工计数和下个时点。
- `POST /scheduler/claim` 在未到时间时返回 `allowed=false`。
- 到点后返回唯一 `claimId`。
- `POST /scheduler/complete` 幂等完成许可。
- `POST /scheduler/pause` 立即阻止新许可。

**Step 2: 实现 API**

```text
GET  /scheduler/status
POST /scheduler/claim
POST /scheduler/complete
POST /scheduler/skip
POST /scheduler/pause
POST /scheduler/resume
```

`claim` 返回：

```json
{
  "allowed": true,
  "claimId": "2026-08-31T10:00:00+08:00-03",
  "dryRun": true,
  "remainingThisHour": 12
}
```

**Step 3: 运行测试并确认通过**

Run: `python -m unittest test_scheduler_api.py -v`

Expected: PASS。

**Step 4: 提交**

```bash
git add main.py test_scheduler_api.py
git commit -m "feat: expose scheduler control API"
```

## Task 5: 为作者原投递流程增加时间门控

**Files:**
- Modify: `web_script.js:406`
- Modify: `web_script.js:682`
- Create: `test_web_script_contract.py`

**Step 1: 写契约测试**

测试脚本必须包含以下 API 调用，并且不存在无限连续投递入口：

```text
/scheduler/status
/scheduler/claim
/scheduler/complete
/scheduler/skip
```

**Step 2: 扩展 Api 类**

增加 `getSchedulerStatus()`、`claimDispatch()`、`completeDispatch()` 和 `skipDispatch()`。

**Step 3: 在原搜索循环外增加许可门控**

- 定时轮询 `claimDispatch()`。
- 未获许可时不打开岗位详情。
- 获得许可后继续执行作者原有的关键词搜索、岗位评分和阈值判断。
- 每次许可最多发送一次作者原流程判定合格的招呼语。
- 没有合格岗位时标记 `skip`，保持作者原有评分阈值不变。
- `dryRun=true` 时只写日志，不点击“立即沟通”和发送按钮。
- 成功、失败和跳过都必须回报对应的 `claimId`。

**Step 4: 验证原投递策略未被修改**

契约测试确认 `api.getJobScore()`、`decision.score >= OPTIONS.thread`、原标签轮换和原招呼语发送路径仍然存在；本任务不修改 `core.py` 评分算法，也不增加新的风控处理。

**Step 5: 检查 JavaScript 语法**

Run: `node --check web_script.js`

Expected: 无输出，退出码为 0。

**Step 6: 运行契约测试并提交**

Run: `python -m unittest test_web_script_contract.py -v`

```bash
git add web_script.js test_web_script_contract.py
git commit -m "feat: gate each application with scheduler permit"
```

## Task 6: 实现严格的索要简历判断

**Files:**
- Create: `resume_intent.py`
- Create: `test_resume_intent.py`
- Modify: `main.py`
- Modify: `schema.py`

**Step 1: 写中文语料测试**

分类结果固定为：`explicit_request`、`ambiguous`、`not_requested`。

明确触发样例：

```text
麻烦发一份简历
简历发我一下
方便把附件简历发过来吗
请发送详细简历
```

禁止触发样例：

```text
我看过你的简历了
你的简历经历不太符合
暂时不需要简历
不用发简历了
```

模糊样例：

```text
详细介绍一下
方便进一步了解吗
有更完整的资料吗
```

**Step 2: 实现纯规则分类器**

```python
class ResumeIntent(str, Enum):
    explicit_request = 'explicit_request'
    ambiguous = 'ambiguous'
    not_requested = 'not_requested'

def classify_resume_intent(latest_hr_message: str) -> ResumeIntent:
    ...
```

判断顺序必须是：否定表达优先于请求表达，明确请求优先于模糊表达。首版不依赖 Ollama，避免模型波动导致误发。

**Step 3: 增加接口**

```text
POST /resume-intent/classify
```

仅接收最新一条 HR 文本和会话标识，不接收整份简历内容。

**Step 4: 运行测试并提交**

Run: `python -m unittest test_resume_intent.py -v`

```bash
git add resume_intent.py test_resume_intent.py main.py schema.py
git commit -m "feat: classify explicit resume requests"
```

## Task 7: 改造聊天处理为严格状态机

**Files:**
- Modify: `web_script.js:1312`
- Modify: `web_script.js:1475`
- Modify: `web_script.js:1651`
- Modify: `main.py`
- Modify: `storage.py`
- Create: `test_conversation_flow.py`

**Step 1: 写失败测试**

覆盖：

- “你好”不发送简历。
- “不用发简历”不发送简历。
- 明确请求只获得一次发送许可。
- 同一消息重复扫描不会重复发送。
- 已发送会话永远不能再次获得发送许可。
- 模糊消息标记为人工接管。

**Step 2: 增加会话接口**

```text
POST /conversations/evaluate
POST /conversations/resume-sent
POST /conversations/hand-off
```

`evaluate` 使用 `conversationKey + latestMessageHash` 做幂等判断。

**Step 3: 替换当前直接发送逻辑**

删除“只要对方发来新消息且还没发过简历，就直接发送简历”的主链行为。只有后端返回 `explicit_request` 和 `sendAllowed=true` 时才调用 `sendResume()`。

**Step 4: 保留作者原有简历选择方式**

继续使用作者现有的 `resumeIndex` 和 `sendResume()`，本轮不修改简历列表选择和回退策略。

**Step 5: 确认发送结果后回复**

只有检测到简历消息已经出现在当前会话后，才发送：

```text
发给您了哈
```

随后将会话设置为 `resume_sent + handed_to_human`。

**Step 6: 验证并提交**

Run: `python -m unittest test_conversation_flow.py -v`

Run: `node --check web_script.js`

```bash
git add web_script.js main.py storage.py test_conversation_flow.py user_config.example.json
git commit -m "feat: send resume only on explicit request"
```

## Task 8: 全量验证、配置说明与人工验收

**Files:**
- Modify: `README.md`

**Step 1: 运行 Python 测试**

Run: `python -m unittest discover -p "test_*.py" -v`

Expected: 全部 PASS。

**Step 2: 检查 JavaScript**

Run: `node --check web_script.js`

Expected: 退出码 0。

**Step 3: dry-run 验收**

- 将测试时间注入为工作日 09:00、12:00、17:59、18:00。
- 验证每小时计划数量、边界和重启恢复。
- 验证 dry-run 不产生任何真实点击。
- 验证“你好”“不用发简历”“请发简历”三种消息路径。
- 验证原搜索词、评分结果、投递阈值和招呼语行为与上游基线一致。

**Step 4: 测试账号小范围验收**

- 保持 `dryRun=false`，单小时目标临时设为 1。
- 发送一个招呼并核对日志。
- 用测试会话发送明确索要简历消息。
- 核对原 `resumeIndex` 选择结果、发送记录、回复内容和人工接管状态。

**Step 5: 更新配置说明**

在 `README.md` 中只补充调度配置、dry-run 和明确索要简历的规则，保持原有 `start_backend.bat` 启动步骤不变。

**Step 6: 最终提交**

```bash
git add README.md
git commit -m "test: document scheduled delivery acceptance results"
```

## 完成标准

- 工作时间之外无法领取投递许可。
- 每个小时的计划数在配置范围内，且执行次数不会超过计划。
- 重启浏览器或后端不会重复消费计划。
- 作者原有岗位搜索、规则评分、阈值、招呼语和简历序号选择逻辑保持不变。
- 非明确索要简历的消息永远不会触发简历发送。
- 简历发送成功后仅回复一次“发给您了哈”，随后转人工。
- 后端仍通过原 `start_backend.bat` 启动，不新增一键启动入口。
- dry-run、暂停和审计日志均可验证。


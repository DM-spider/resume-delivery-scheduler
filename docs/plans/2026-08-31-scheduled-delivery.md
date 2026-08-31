# Scheduled Resume Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保留原作者的岗位搜索、评分、筛选和打招呼流程，只增加工作日 09:00-18:00 每小时随机投递 10-20 份的时间控制，并将简历发送条件改为“HR 明确索要”。

**Architecture:** 调度状态只保存在当前油猴脚本的内存中，不增加 SQLite、调度 API 或新后端进程。油猴脚本启动后为每个小时生成 10-20 个分散的随机时点，在原作者判定岗位可以投递后等待下一个时点，再继续执行原打招呼流程；聊天页只在最新 HR 消息明确索要简历且当前会话未发过简历时调用作者原有 `sendResume()`。

**Tech Stack:** Python 3、FastAPI、Tampermonkey、原生 JavaScript、BroadcastChannel、unittest。

---

## 需求口径

- 默认工作日为周一至周五。
- 执行窗口为 `09:00 <= 当前时间 < 18:00`，共 9 个小时窗口。
- 每个小时随机确定 10-20 个投递时点，并按时间先后逐份执行。
- 随机时点分散在整个小时内，不在某个随机时间集中连续发送。
- 每个随机时点最多允许一次打招呼尝试；成功或失败均进入下一个时点，不集中重试。
- 计划和计数只在项目本次运行期间有效；浏览器脚本重新加载后重新开始计算。
- 不增加 SQLite、文件持久化、调度状态 API 或状态管理页面。
- 调度信息直接输出到原有页面日志和浏览器控制台。
- 不新增一键启动入口，继续使用原作者的 `start_backend.bat`。
- 不修改 `core.py` 的关键词评分、权重、阈值和岗位匹配策略。
- 不修改作者现有的搜索词轮换、岗位详情读取和招呼语发送逻辑。
- 不修改作者现有的 `resumeIndex` 和简历选择方式。
- 不新增 `dryRun`；该能力不属于原作者项目。
- 每个聊天会话最多自动发送一次简历，发送后不再自动聊天。

## 作者搜索词说明

作者的搜索词配置名是 `tags`：

- `config.py` 的 `DEFAULT_USER_CONFIG['tags']` 提供代码内默认值。
- `user_config.example.json` 提供用户配置模板。
- 实际运行时，如果项目根目录存在 `user_config.json`，其中的 `tags` 会覆盖默认值。
- 后端通过现有 `/client-config` 返回 `tags`，油猴脚本按数组顺序循环搜索。

本次开发只增加调度配置，不改变 `tags` 的读取、覆盖和轮换方式。

## 执行流程

```text
原作者搜索关键词并读取岗位
            ↓
原作者规则计算岗位分数
            ↓
未达到原阈值 ─────────→ 按原逻辑处理下一个岗位
            ↓ 达到阈值
等待当前小时下一个随机时点
            ↓
执行原作者打招呼流程
            ↓
处理下一份岗位

HR 发来新消息
      ↓
当前会话是否已经发过简历？── 是 → 不处理
      ↓ 否
最新 HR 消息是否明确索要简历？── 否 → 不处理，留给用户
      ↓ 是
调用原作者 sendResume(resumeIndex)
      ↓
回复“发给您了哈”并停止自动聊天
```

## Task 1: 增加最小调度配置

**Files:**
- Modify: `config.py`
- Modify: `user_config.example.json`
- Modify: `test_single_route_backend.py`

**Step 1: 写失败测试**

验证 `/client-config` 返回新的 `schedule`，同时原有 `tags`、`introduce` 和 `frontend` 内容保持不变：

```python
self.assertEqual(Config.schedule['weekdays'], [1, 2, 3, 4, 5])
self.assertEqual(Config.schedule['startHour'], 9)
self.assertEqual(Config.schedule['endHour'], 18)
self.assertEqual(Config.schedule['minPerHour'], 10)
self.assertEqual(Config.schedule['maxPerHour'], 20)
self.assertEqual(Config.tags, ['AI产品工程师', 'AI应用工程师'])
```

**Step 2: 运行测试并确认失败**

Run: `python -m unittest test_single_route_backend.py -v`

Expected: FAIL，提示 `Config` 没有 `schedule`。

**Step 3: 增加配置**

在默认配置和用户配置模板中增加：

```json
"schedule": {
  "enabled": true,
  "weekdays": [1, 2, 3, 4, 5],
  "startHour": 9,
  "endHour": 18,
  "minPerHour": 10,
  "maxPerHour": 20
}
```

`Config.get_client_config()` 只增加 `schedule` 字段，不修改现有字段。

**Step 4: 运行测试并确认通过**

Run: `python -m unittest test_single_route_backend.py -v`

Expected: 原有测试和新增测试全部 PASS。

**Step 5: 提交**

```bash
git add config.py user_config.example.json test_single_route_backend.py
git commit -m "feat: add delivery schedule configuration"
```

## Task 2: 在油猴脚本内增加小时调度

**Files:**
- Modify: `web_script.js:15`
- Modify: `web_script.js:682`

**Step 1: 实现内存调度器**

在 `web_script.js` 内增加一个小型 `HourlyScheduler`，只保存：

```javascript
{
  hourKey: '',
  slots: [],
  cursor: 0
}
```

它提供以下行为：

- 判断当前是否为配置中的工作日和工作时间。
- 每进入一个新小时，随机生成 10-20 个时点。
- 将当前小时平均分成 N 段，每段随机选择一个时点，使投递分散。
- 对已经错过的时点直接跳过。
- 返回距离下一个时点的等待毫秒数。
- 浏览器脚本重新加载后状态清空，不读写数据库或本地文件。

**Step 2: 接入现有配置**

从已有 `/client-config` 响应读取 `schedule`，不增加任何新接口。

**Step 3: 接入原作者投递流程**

仅在 `decision.score >= OPTIONS.thread` 后、执行原打招呼动作前等待下一个调度时点：

```text
原评分通过
→ scheduler.waitForNextSlot()
→ 原 addToChatList()
→ 原 SAY_HI 流程
```

不得修改以下行为：

- `api.getJobScore()` 调用方式。
- `decision.score >= OPTIONS.thread` 判断。
- 标签轮换和岗位详情读取。
- `pendingGreetDecision`、`addToChatList()` 和 `SAY_HI` 流程。

**Step 4: 输出日志**

使用已有 `Logger.add()` 输出：

```text
本小时计划投递 14 份
下一份计划时间 10:17:35
执行本小时第 4/14 份
当前不在投递时间，等待下一个工作时段
```

不增加调度 API 和状态页面。

**Step 5: 检查 JavaScript 语法**

Run: `node --check web_script.js`

Expected: 无输出，退出码为 0。

**Step 6: 提交**

```bash
git add web_script.js
git commit -m "feat: schedule hourly greeting attempts"
```

## Task 3: 仅在 HR 明确索要时发送简历

**Files:**
- Modify: `web_script.js:1475`
- Modify: `web_script.js:1651`

**Step 1: 增加严格判断函数**

在浏览器脚本内增加 `isExplicitResumeRequest(message)`，只读取最新一条 HR 文本。

判断顺序：

1. 先匹配否定表达，命中后禁止发送。
2. 再匹配明确请求表达，命中后允许发送。
3. 其他内容一律不发送。

明确允许的基础表达：

```text
发一份简历
简历发我一下
请发送简历
麻烦把简历发过来
方便发下详细简历吗
```

明确禁止的基础表达：

```text
不用发简历
不需要简历
我看过你的简历
简历不太匹配
暂不考虑
```

“你好”“方便聊聊吗”“详细介绍一下”等其他消息全部不发送简历。

**Step 2: 替换直接发送条件**

将当前：

```text
新消息 + 未发送过简历 → 直接发送简历
```

改成：

```text
新消息 + 未发送过简历 + 最新 HR 消息明确索要 → 发送简历
```

继续使用作者现有 `chatInfo.resumeSended` 防止同一会话重复发送，不新增 SQLite 或会话状态接口。

**Step 3: 保留原简历选择逻辑**

继续调用：

```javascript
sendResume(decision.resumeIndex)
```

不修改 `resumeIndex`、简历列表选择和回退方式。

**Step 4: 修改成功回复**

简历发送动作完成后，将原来的“已发送，请查收”改为：

```text
发给您了哈
```

之后继续保持作者当前行为：已发过简历则跳过自动聊天。

**Step 5: 检查语法并提交**

Run: `node --check web_script.js`

Expected: 无输出，退出码为 0。

```bash
git add web_script.js
git commit -m "feat: require explicit resume request"
```

## Task 4: 回归验证和文档更新

**Files:**
- Modify: `README.md`

**Step 1: 运行原作者后端测试**

Run: `python -m unittest test_single_route_backend.py -v`

Expected: 全部 PASS，岗位评分结果与上游基线一致。

**Step 2: 检查浏览器脚本**

Run: `node --check web_script.js`

Expected: 退出码为 0。

**Step 3: 验证时间边界**

在测试配置中临时把每小时数量设为 1，分别验证：

- 周一 08:59 不投递。
- 周一 09:00 开始生成本小时计划。
- 周一 17:59 仍属于投递窗口。
- 周一 18:00 不再投递。
- 周六不投递。
- 新小时会重新生成计划和计数。

**Step 4: 验证消息条件**

使用测试会话核对：

- “你好”不发送简历。
- “方便聊聊吗”不发送简历。
- “我看过你的简历”不发送简历。
- “不用发简历”不发送简历。
- “麻烦发一份简历”发送一次简历。
- 重复扫描同一会话不再次发送。
- 发送成功后回复“发给您了哈”。

**Step 5: 更新 README**

只补充以下内容：

- `schedule` 配置说明。
- `tags` 的默认值与 `user_config.json` 覆盖方式。
- 工作时间和每小时随机投递规则。
- 明确索要简历的判断规则。

保持原 `start_backend.bat` 启动说明不变。

**Step 6: 提交**

```bash
git add README.md
git commit -m "docs: document scheduled delivery behavior"
```

## 完成标准

- 项目仍通过原 `start_backend.bat` 启动。
- 不存在 `dryRun`、SQLite、调度 API 或一键启动器。
- 作者原有 `tags` 配置和搜索词轮换方式保持不变。
- 作者原有岗位评分、投递阈值和招呼语流程保持不变。
- 工作日 09:00-18:00 每小时在内存中生成 10-20 个随机时点。
- 每个时点最多执行一次原作者打招呼尝试。
- 非明确索要简历的消息不会触发简历发送。
- 同一会话最多自动发送一次简历。
- 简历发送后回复一次“发给您了哈”，之后不再自动聊天。
- 调度计划和执行进度可以在原页面日志中查看。


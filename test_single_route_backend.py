import asyncio
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TEST_USER_CONFIG = {
    'introduce': '测试用打招呼语',
    'tags': ['算法工程师', '大模型工程师', 'AI应用工程师'],
    'backend': {
        'job_score_delay_base_ms': 0,
        'job_score_delay_jitter_ms': 0,
    },
    'frontend': {
        'serverHost': 'http://127.0.0.1:8000',
        'resumeIndex': 0,
        'thread': 50,
        'onlyGreet': False,
        'manualFilterWaitMs': 10000,
        'detailTimeout': 10000,
        'greetTimeout': 12000,
        'resumeScanTimeout': 120000,
        'preloadScrollPixels': 180,
        'preloadScrollWaitMs': 450,
        'preloadStableRoundsLimit': 24,
        'preloadMaxRounds': 300,
        'preloadActivateCardEvery': 0,
        'preloadActivateCardWaitMs': 250,
    },
}


def build_job(title: str, detail: str, salary: str = '20-30K') -> str:
    return f'# 职位名称\n{title}\n\n# 薪资范围\n{salary}\n\n# 职位描述\n{detail}'


def install_fastapi_stub():
    if 'fastapi' in sys.modules:
        return

    fastapi_stub = types.ModuleType('fastapi')

    class FastAPI:
        def get(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator

        def post(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator

    class HTTPException(Exception):
        pass

    def Body(*args, **kwargs):
        return ...

    fastapi_stub.FastAPI = FastAPI
    fastapi_stub.Body = Body
    fastapi_stub.HTTPException = HTTPException
    sys.modules['fastapi'] = fastapi_stub


def purge_modules():
    for name in ['config', 'core', 'main']:
        sys.modules.pop(name, None)


class SingleRouteBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.original_config_path = os.environ.get('JOB_APPLY_SCHEDULER_CONFIG_PATH')
        cls.user_config_path = Path(cls.temp_dir.name) / 'user_config.json'
        os.environ['JOB_APPLY_SCHEDULER_CONFIG_PATH'] = str(cls.user_config_path)
        cls.user_config_path.write_text(
            json.dumps(TEST_USER_CONFIG, ensure_ascii=False, indent=2),
            encoding='utf-8'
        )
        purge_modules()

    @classmethod
    def tearDownClass(cls):
        if cls.original_config_path is None:
            os.environ.pop('JOB_APPLY_SCHEDULER_CONFIG_PATH', None)
        else:
            os.environ['JOB_APPLY_SCHEDULER_CONFIG_PATH'] = cls.original_config_path
        purge_modules()
        cls.temp_dir.cleanup()

    def test_client_config_no_longer_exposes_profile(self):
        from config import Config

        client_config = Config.get_client_config()
        self.assertIn('introduce', client_config)
        self.assertIn('frontend', client_config)
        self.assertNotIn('profile', client_config)

    def test_client_config_exposes_schedule(self):
        from config import Config

        schedule = Config.get_client_config()['schedule']
        self.assertEqual(schedule['weekdays'], [1, 2, 3, 4, 5])
        self.assertEqual(schedule['startHour'], 9)
        self.assertEqual(schedule['endHour'], 18)
        self.assertEqual(schedule['jobsPerRound'], 50)
        self.assertNotIn('minPerHour', schedule)
        self.assertNotIn('maxPerHour', schedule)
        self.assertEqual(schedule['testIntervalSeconds'], 10)
        self.assertEqual(schedule['strategies'], [
            'balanced',
            'front_loaded',
            'back_loaded',
            'two_waves',
            'mixed_cadence',
        ])
        self.assertEqual(Config.get_client_config()['frontend']['resumeScanTimeout'], 120000)

    def test_client_config_uses_fifty_jobs_per_round_without_run_limit(self):
        from config import Config

        client_config = Config.get_client_config()
        self.assertEqual(client_config['schedule']['jobsPerRound'], 50)
        self.assertNotIn('maxJobsPerRun', client_config['frontend'])

    def test_userscript_allows_local_backend_connection(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8').lower()

        self.assertIn('// @version      2026-09-01', script)
        self.assertIn('// @connect      127.0.0.1', script)
        self.assertIn('jobsperround', script)
        self.assertNotIn('maxjobsperrun', script)

    def test_userscript_processes_each_job_then_scans_resume_requests(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn('processRoundJobs', script)
        self.assertNotIn('scanRoundJobs', script)
        self.assertNotIn('deliverRoundJobs', script)
        self.assertIn('processResumeRequests', script)
        self.assertIn('await processResumeRequests()', script)
        self.assertIn('await scheduler.waitForNextRound', script)
        self.assertNotIn('已完成 ${count} 个真实 JD 的试运行', script)
        run_round_start = script.index('const runRound = async () =>')
        run_round_end = script.index('const runHourlyLoop = async () =>', run_round_start)
        run_round = script[run_round_start:run_round_end]
        self.assertLess(run_round.index('await processRoundJobs()'), run_round.index('await processResumeRequests()'))

        process_start = script.index('const processRoundJobs = async () =>')
        process_end = script.index('const processResumeRequests = async () =>', process_start)
        process_round = script[process_start:process_end]
        self.assertLess(process_round.index('await scheduler.waitForRoundSlot'), process_round.index('processedJobKeys.add(job.key)'))
        self.assertLess(process_round.index('if (scheduledSlot.expired)'), process_round.index('processedJobKeys.add(job.key)'))
        self.assertLess(process_round.index('processedJobKeys.add(job.key)'), process_round.index('await getJobInfo(job.href)'))
        self.assertLess(process_round.index('await getJobInfo(job.href)'), process_round.index('await api.getJobScore'))
        self.assertLess(process_round.index('await api.getJobScore'), process_round.index('await sendGreeting({ info: jobInfo })'))
        self.assertIn('logger.divider()', process_round)
        self.assertIn('本时点不读取岗位', script)

    def test_userscript_exposes_start_and_stop_controls(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn('runBtn.innerText = "开始"', script)
        self.assertIn('runBtn.innerText = running ? "结束" : "开始"', script)
        self.assertIn('logger.stop()', script)
        self.assertIn('if (isPaused()) return null', script)
        self.assertIn('if (scheduledSlot === null)', script)

    def test_userscript_log_panel_starts_collapsed_with_requested_size(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertGreaterEqual(script.count('width: 360px;'), 3)
        self.assertIn('foldBtn.innerText = "展开";', script)
        self.assertIn('msgList.style.height = "560px";', script)
        self.assertIn('msgList.style.height = "32px";', script)

    def test_userscript_preload_can_be_stopped(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn('const sleepUnlessPaused = async (durationMs)', script)
        self.assertIn("logger.add('预加载已由结束按钮中止')", script)
        self.assertIn('if (!await preloadJobs() || this.pause) return;', script)
        self.assertNotIn('msgList.style.height = "720px";', script)

    def test_userscript_uses_stable_read_only_worker_roles(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn('detail: "__zhipin_detail_worker"', script)
        self.assertIn('chat: "__zhipin_resume_worker"', script)
        self.assertIn('chatGreet: "__zhipin_greet_worker"', script)
        self.assertIn('openWorkerTabPrepared(href, role, onCreated)', script)
        self.assertIn('createWorkerTask(role)', script)
        self.assertIn('isWorkerTaskClaimed(task)', script)
        self.assertIn('installWorkerReadOnlyGuard', script)
        self.assertIn('event.isTrusted', script)
        self.assertNotIn('openTabNSetTimestamp', script)
        self.assertNotIn('timestampTimeout', script)

    def test_userscript_stop_broadcast_reaches_all_workers(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn("STOP: 'stop'", script)
        self.assertIn("this.broadcast.send('all', this.bcTypes.STOP", script)
        self.assertIn('AutomationRuntime.stop()', script)
        self.assertIn('assertWorkerRunning', script)

    def test_userscript_message_send_survives_worker_tab_focus(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn("new InputEvent('input'", script)
        self.assertIn("new Event('change', { bubbles: true })", script)
        self.assertIn('findReadySendButton', script)
        self.assertIn('waitForMessageSent', script)
        self.assertIn('document.querySelectorAll(SELECTORS.ZHIPIN.CHAT.MSGSEND)', script)
        self.assertIn("throw new Error('send_button_not_ready')", script)
        self.assertIn("throw new Error('message_send_not_confirmed')", script)
        self.assertIn("error: e?.message || String(e)", script)

    def test_userscript_leaves_manual_chat_unmanaged_and_keeps_shared_logs(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn('if (!isGreetWorker && !isResumeWorker) return;', script)
        self.assertNotIn('MANUAL_TAKEOVER_KEY', script)
        self.assertNotIn('acquireManualTakeover', script)
        self.assertNotIn('__setupManualChatPage', script)
        self.assertNotIn('manual_takeover', script)
        self.assertIn('SharedLogStore', script)
        self.assertIn('SHARED_LOG_LIMIT: 200', script)

    def test_userscript_runtime_state_and_worker_task_deduplication(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')
        runtime_start = script.index('    const RUNTIME_KEYS')
        runtime_end = script.index('    function installWorkerReadOnlyGuard', runtime_start)
        runtime_source = script[runtime_start:runtime_end]
        node_script = f"""
function createStorage() {{
    const values = new Map();
    return {{
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    }};
}}
globalThis.localStorage = createStorage();
globalThis.sessionStorage = createStorage();
{runtime_source}
AutomationRuntime.start();
if (!AutomationRuntime.isRunning()) throw new Error('runtime did not start');
const task = AutomationRuntime.createWorkerTask('detail');
if (AutomationRuntime.getWorkerTask('detail').id !== task.id) throw new Error('task not stored');
if (!AutomationRuntime.isWorkerTaskCurrent(task)) throw new Error('task run id mismatch');
if (!AutomationRuntime.claimWorkerTask(task)) throw new Error('first claim failed');
if (AutomationRuntime.claimWorkerTask(task)) throw new Error('duplicate claim succeeded');
AutomationRuntime.setClientConfig({{ frontend: {{ resumeIndex: 2 }} }});
if (AutomationRuntime.getClientConfig().frontend.resumeIndex !== 2) throw new Error('client config not cached');
for (let index = 0; index < 205; index++) SharedLogStore.append(`log-${{index}}`);
if (SharedLogStore.read().length !== 200) throw new Error('shared log limit failed');
AutomationRuntime.stop();
if (AutomationRuntime.isRunning()) throw new Error('runtime did not stop');
AutomationRuntime.start();
if (AutomationRuntime.isWorkerTaskCurrent(task)) throw new Error('old task survived restart');
"""
        result = subprocess.run(
            ['node', '-e', node_script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding='utf-8',
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_userscript_randomly_selects_five_hourly_strategies(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        for strategy_id in [
            'balanced',
            'front_loaded',
            'back_loaded',
            'two_waves',
            'mixed_cadence',
        ]:
            self.assertIn(f"id: '{strategy_id}'", script)
        self.assertIn('Math.floor(Math.random() * strategies.length)', script)
        self.assertIn('本轮策略', script)

    def test_all_hourly_strategies_generate_sorted_in_hour_slots(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')
        class_start = script.index('    class HourlyScheduler')
        class_end = script.index('    // boss 直聘', class_start)
        scheduler_source = script[class_start:class_end]
        node_script = f"""
const tools = {{ asyncSleep: async () => undefined }};
{scheduler_source}
const strategyIds = ['balanced', 'front_loaded', 'back_loaded', 'two_waves', 'mixed_cadence'];
const scheduler = new HourlyScheduler({{ jobsPerRound: 50, strategies: strategyIds }});
for (const strategyId of strategyIds) {{
    for (const count of [10, 15, 20]) {{
        const offsets = scheduler.buildStrategyOffsets(strategyId, count);
        if (offsets.length !== count) throw new Error(`${{strategyId}} count mismatch`);
        if (offsets.some((offset) => offset < 0 || offset >= 3600000)) throw new Error(`${{strategyId}} out of hour`);
        if (offsets.some((offset, index) => index > 0 && offset < offsets[index - 1])) throw new Error(`${{strategyId}} not sorted`);
    }}
}}
const originalRandom = Math.random;
Math.random = () => 0;
const mixedOffsets = scheduler.buildStrategyOffsets('mixed_cadence', 10);
Math.random = originalRandom;
if (!mixedOffsets.some((offset, index) => index > 0 && offset - mixedOffsets[index - 1] === 10000)) {{
    throw new Error('mixed_cadence has no 10 second gap');
}}
const originalNow = Date.now;
Date.now = () => new Date('2026-09-01T09:05:00').getTime();
const planned = scheduler.planRound(7, null, new Date('2026-09-01T09:05:00'));
Date.now = originalNow;
if (planned.length !== 7) throw new Error('planRound must use the candidate job count');
if (scheduler.cursor !== 0) throw new Error('planRound must reset the round cursor');
"""
        result = subprocess.run(
            ['node', '-e', node_script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding='utf-8',
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_scheduler_discards_expired_slot_without_waiting(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')
        class_start = script.index('    class HourlyScheduler')
        class_end = script.index('    // boss 直聘', class_start)
        scheduler_source = script[class_start:class_end]
        node_script = f"""
let sleepCount = 0;
const tools = {{ asyncSleep: async () => {{ sleepCount++; }} }};
{scheduler_source}
(async () => {{
    const nowMs = Date.now();
    const scheduler = new HourlyScheduler({{ testIntervalSeconds: 0 }});
    scheduler.slots = [nowMs - 1000];
    const messages = [];
    const result = await scheduler.waitForRoundSlot((message) => messages.push(message), () => false);
    if (!result || !result.expired) throw new Error('expired slot was not discarded');
    if (scheduler.cursor !== 1) throw new Error('expired slot did not advance cursor');
    if (sleepCount !== 0) throw new Error('expired slot unexpectedly waited');
    if (!messages.some((message) => message.includes('本时点不读取岗位'))) {{
        throw new Error('expired slot did not explain that the job remains unread');
    }}
}})().catch((error) => {{ console.error(error); process.exit(1); }});
"""
        result = subprocess.run(
            ['node', '-e', node_script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding='utf-8',
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_scheduler_waits_for_next_hour_after_completed_round(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')
        class_start = script.index('    class HourlyScheduler')
        class_end = script.index('    // boss 直聘', class_start)
        scheduler_source = script[class_start:class_end]
        node_script = f"""
const tools = {{ asyncSleep: async () => undefined }};
{scheduler_source}
(async () => {{
    const RealDate = Date;
    let nowMs = RealDate.parse('2026-09-01T10:05:00');
    globalThis.Date = class extends RealDate {{
        constructor(value) {{ super(value === undefined ? nowMs : value); }}
        static now() {{ return nowMs; }}
    }};
    const scheduler = new HourlyScheduler({{ testIntervalSeconds: 10 }});
    scheduler.sleepUntil = async (targetMs) => {{ nowMs = targetMs; return true; }};
    const first = await scheduler.waitForNextRound(false, () => undefined, () => false);
    if (first.getTime() !== RealDate.parse('2026-09-01T10:05:00')) {{
        throw new Error('first round did not start immediately');
    }}
    const second = await scheduler.waitForNextRound(true, () => undefined, () => false);
    if (second.getTime() !== RealDate.parse('2026-09-01T11:00:00')) {{
        throw new Error('completed round did not wait for next hour');
    }}
}})().catch((error) => {{ console.error(error); process.exit(1); }});
"""
        result = subprocess.run(
            ['node', '-e', node_script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding='utf-8',
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_worker_open_order_and_resume_scan_timeout(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')
        helper_start = script.index('        openWorkerTabPrepared(href, role, onCreated)')
        helper_end = script.index('        openControllerPage', helper_start)
        helper = script[helper_start:helper_end]

        self.assertLess(helper.index('onCreated(task)'), helper.index('window.open(href, role)'))
        self.assertIn('cancelReceive(this.targets.detail', script)
        self.assertIn('resume_scan_timeout', script)
        self.assertIn('resume_window_blocked', script)
        self.assertIn('pendingResumeTimer', script)

    def test_latest_resume_request_card_controls_automatic_send(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn("const latest = timeline.at(-1)", script)
        self.assertIn("hasResumeRequestCard: latest?.type === 'resume_request_card'", script)
        self.assertNotIn("hasResumeRequestCard = true", script)

    def test_removed_userscript_dead_code_stays_removed(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        for dead_symbol in [
            'inWhiteList:',
            'function convertTime',
            'sendAndReceive(',
            'generateRequestId(',
            'pendingResponses',
            'this.introduce',
            'completeWorkerTask(',
        ]:
            self.assertNotIn(dead_symbol, script)

    def test_search_tags_target_algorithm_and_llm_roles(self):
        from config import Config

        self.assertEqual(Config.tags[:3], ['算法工程师', '大模型工程师', 'AI应用工程师'])

    def test_llm_algorithm_role_scores_high(self):
        from core import evaluateJobMatch

        job = build_job(
            '大模型算法工程师',
            '负责 Agent 智能体、RAG 混合检索、BGE 重排序、QLoRA 微调、PyTorch 模型评测与 Python 服务化。',
        )
        result = evaluateJobMatch(job)

        self.assertFalse(result['blocked'])
        self.assertGreaterEqual(result['score'], 90)

    def test_generic_algorithm_role_requires_relevant_jd(self):
        from core import evaluateJobMatch

        job = build_job(
            '算法工程师',
            '使用 Scikit-learn、LightGBM、XGBoost 和 PyTorch 完成特征工程、分类回归、时序验证及模型评估。',
        )
        result = evaluateJobMatch(job)

        self.assertFalse(result['blocked'])
        self.assertGreaterEqual(result['score'], 70)

    def test_generic_algorithm_role_without_relevant_jd_stays_below_threshold(self):
        from core import evaluateJobMatch

        job = build_job('算法工程师', '负责跨部门需求沟通、项目进度跟踪和业务文档整理。')
        result = evaluateJobMatch(job)

        self.assertFalse(result['blocked'])
        self.assertLess(result['score'], 50)

    def test_computer_vision_algorithm_role_is_blocked(self):
        from core import evaluateJobMatch

        job = build_job('计算机视觉算法工程师', '负责 YOLO 目标检测、图像分割和 OpenCV 工程优化。')
        result = evaluateJobMatch(job)

        self.assertTrue(result['blocked'])
        self.assertEqual(result['score'], 0)

    def test_robotics_role_is_blocked(self):
        from core import evaluateJobMatch

        result = evaluateJobMatch(build_job('机器人大模型算法工程师', '负责机器人感知与控制算法。'))

        self.assertTrue(result['blocked'])
        self.assertEqual(result['score'], 0)
        self.assertEqual(result['keyword'], '机器人')

    def test_campus_or_graduate_job_detail_is_blocked(self):
        from core import evaluateJobMatch

        result = evaluateJobMatch(build_job('大模型应用工程师', '2026 秋招岗位，面向应届毕业生。'))

        self.assertTrue(result['blocked'])
        self.assertEqual(result['score'], 0)
        self.assertEqual(result['matched_field'], 'detail_negative')

    def test_robotics_job_detail_receives_domain_penalty(self):
        from core import evaluateJobMatch

        normal = evaluateJobMatch(build_job('算法工程师', '负责 Python 算法服务开发。'))
        robotics = evaluateJobMatch(build_job('算法工程师', '负责机器人和具身智能算法，使用 Python 开发。'))

        self.assertFalse(robotics['blocked'])
        self.assertLess(robotics['score'], normal['score'])
        self.assertIn('机器人', robotics['detail_negative_matches'])

    def test_salary_floor_equal_to_limit_is_allowed(self):
        from core import evaluateJobMatch

        job = build_job(
            '大模型算法工程师',
            '负责 Agent、RAG、QLoRA 与 PyTorch 模型评测。',
            salary='25-40K·14薪',
        )
        result = evaluateJobMatch(job)

        self.assertFalse(result['blocked'])
        self.assertEqual(result['salary_min_k'], 25)
        self.assertGreaterEqual(result['score'], 90)

    def test_salary_floor_above_limit_is_blocked(self):
        from core import evaluateJobMatch

        job = build_job(
            '大模型算法工程师',
            '负责 Agent、RAG、QLoRA 与 PyTorch 模型评测。',
            salary='25.1-40K',
        )
        result = evaluateJobMatch(job)

        self.assertTrue(result['blocked'])
        self.assertEqual(result['matched_field'], 'salary_negative')
        self.assertEqual(result['score'], 0)
        self.assertIn('超过限制 25K', result['reason'])

    def test_unparseable_salary_is_not_blocked(self):
        from core import evaluateJobMatch

        job = build_job(
            'AI应用工程师',
            '负责 Agent、RAG、提示词工程与 Python 服务化。',
            salary='面议',
        )
        result = evaluateJobMatch(job)

        self.assertFalse(result['blocked'])
        self.assertIsNone(result['salary_min_k'])

    def test_start_script_has_no_author_specific_python_path(self):
        script = (ROOT / 'start_backend.bat').read_text(encoding='utf-8').lower()

        self.assertNotIn('c:\\users\\', script)
        self.assertIn('jobapplyscheduler', script)
        self.assertIn(r'.venv\scripts\python.exe', script)
        self.assertNotIn('where py', script)
        self.assertNotIn('where python', script)
        self.assertIn('-m pip install -r requirements.txt', script)

    def test_legacy_brand_only_remains_in_readme_source_note(self):
        legacy_terms = ('good' + 'job', 'cz' + 'c', '\u539f\u4f5c\u8005')
        excluded_dirs = {'.git', '.venv', '.claude', '__pycache__'}
        text_suffixes = {'.py', '.js', '.json', '.md', '.bat', '.gitignore'}
        for path in ROOT.rglob('*'):
            if not path.is_file() or path.name in {'README.md', Path(__file__).name}:
                continue
            if any(part in excluded_dirs for part in path.parts):
                continue
            if path.suffix.lower() not in text_suffixes and path.name != '.gitignore':
                continue
            content = path.read_text(encoding='utf-8', errors='ignore').lower()
            for term in legacy_terms:
                self.assertNotIn(term.lower(), content, str(path))

        readme = (ROOT / 'README.md').read_text(encoding='utf-8')
        self.assertTrue(readme.startswith('# JobApplyScheduler'))
        self.assertIn('## 项目来源', readme)

    def test_get_job_score_returns_single_route_shape(self):
        install_fastapi_stub()
        from main import get_job_score

        job = build_job('AI应用工程师', '负责 Agent、RAG、提示词工程、Python 服务化与部署')
        result = asyncio.run(get_job_score(job))

        self.assertIn('score', result)
        self.assertNotIn('introduce', result)
        self.assertNotIn('resumeIndex', result)
        self.assertNotIn('profile', result)
        self.assertNotIn('routeReason', result)
        self.assertNotIn('routeScores', result)


if __name__ == '__main__':
    unittest.main()

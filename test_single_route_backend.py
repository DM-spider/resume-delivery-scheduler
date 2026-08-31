import asyncio
import json
import subprocess
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
USER_CONFIG_PATH = ROOT / 'user_config.json'
ORIGINAL_USER_CONFIG = USER_CONFIG_PATH.read_text(encoding='utf-8') if USER_CONFIG_PATH.exists() else None
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
        'timestampTimeout': 3000,
        'onlyGreet': False,
        'manualFilterWaitMs': 10000,
        'roundRestartDelayMs': 2000,
        'maxEmptyRounds': 3,
        'detailTimeout': 10000,
        'greetTimeout': 12000,
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
        USER_CONFIG_PATH.write_text(
            json.dumps(TEST_USER_CONFIG, ensure_ascii=False, indent=2),
            encoding='utf-8'
        )
        purge_modules()

    @classmethod
    def tearDownClass(cls):
        if ORIGINAL_USER_CONFIG is None:
            USER_CONFIG_PATH.unlink(missing_ok=True)
        else:
            USER_CONFIG_PATH.write_text(ORIGINAL_USER_CONFIG, encoding='utf-8')
        purge_modules()

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
        self.assertEqual(schedule['minPerHour'], 10)
        self.assertEqual(schedule['maxPerHour'], 20)
        self.assertEqual(schedule['testIntervalSeconds'], 0)
        self.assertEqual(schedule['strategies'], [
            'balanced',
            'front_loaded',
            'back_loaded',
            'two_waves',
            'mixed_cadence',
        ])

    def test_client_config_limits_run_to_two_hundred_real_jobs(self):
        from config import Config

        self.assertEqual(Config.get_client_config()['frontend']['maxJobsPerRun'], 200)

    def test_userscript_allows_local_backend_connection(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8').lower()

        self.assertIn('// @connect      127.0.0.1', script)
        self.assertIn('maxjobsperrun: 200', script)

    def test_userscript_exposes_start_and_stop_controls(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')

        self.assertIn('runBtn.innerText = "开始"', script)
        self.assertIn('runBtn.innerText = running ? "结束" : "开始"', script)
        self.assertIn('logger.stop()', script)
        self.assertIn('if (isPaused()) return null', script)
        self.assertIn('if (scheduledSlot === null)', script)

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
        self.assertIn('本小时策略', script)

    def test_all_hourly_strategies_generate_sorted_in_hour_slots(self):
        script = (ROOT / 'web_script.js').read_text(encoding='utf-8')
        class_start = script.index('    class HourlyScheduler')
        class_end = script.index('    // boss 直聘', class_start)
        scheduler_source = script[class_start:class_end]
        node_script = f"""
const tools = {{ asyncSleep: async () => undefined }};
{scheduler_source}
const strategyIds = ['balanced', 'front_loaded', 'back_loaded', 'two_waves', 'mixed_cadence'];
const scheduler = new HourlyScheduler({{ minPerHour: 10, maxPerHour: 20, strategies: strategyIds }});
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

        self.assertNotIn(r'c:\users\czc', script)
        self.assertIn(r'.venv\scripts\python.exe', script)
        self.assertNotIn('where py', script)
        self.assertNotIn('where python', script)
        self.assertIn('-m pip install -r requirements.txt', script)

    def test_single_route_delivery_uses_fixed_introduce_and_resume_index(self):
        from core import evaluateSingleRouteDelivery
        from config import Config

        job = build_job('AI应用工程师', '负责 Agent、RAG、提示词工程、Python 服务化与部署')
        result = evaluateSingleRouteDelivery(job)

        self.assertEqual(result['introduce'], Config.introduce)
        self.assertEqual(result['resumeIndex'], Config.frontend.get('resumeIndex', 0))
        self.assertNotIn('profile', result)
        self.assertNotIn('route_reason', result)
        self.assertNotIn('route_scores', result)

    def test_get_job_score_returns_single_route_shape(self):
        install_fastapi_stub()
        from main import get_job_score

        job = build_job('AI应用工程师', '负责 Agent、RAG、提示词工程、Python 服务化与部署')
        result = asyncio.run(get_job_score(job))

        self.assertIn('score', result)
        self.assertIn('introduce', result)
        self.assertIn('resumeIndex', result)
        self.assertNotIn('profile', result)
        self.assertNotIn('routeReason', result)
        self.assertNotIn('routeScores', result)


if __name__ == '__main__':
    unittest.main()

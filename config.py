import copy
import json
import os


DEFAULT_USER_CONFIG = {
    'introduce': '您好，我主要从事大模型应用与算法工程，具备 Agent、RAG、模型微调、机器学习及 Python 服务化经验，希望进一步了解这个岗位。',
    'tags': ['算法工程师', '大模型工程师', '大模型算法工程师', 'AI算法工程师', 'AI应用工程师', '机器学习工程师', 'NLP算法工程师', '智能体工程师', 'RAG工程师', '大模型应用工程师'],
    'schedule': {
        'weekdays': [1, 2, 3, 4, 5],
        'startHour': 9,
        'endHour': 18,
        'minPerHour': 10,
        'maxPerHour': 20,
        'testIntervalSeconds': 10,
        'strategies': [
            'balanced',
            'front_loaded',
            'back_loaded',
            'two_waves',
            'mixed_cadence',
        ],
    },
    'backend': {
        'job_score_delay_base_ms': 4000,
        'job_score_delay_jitter_ms': 500,
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
        'maxJobsPerRun': 200,
        'detailTimeout': 10000,
        'greetTimeout': 12000,
        'preloadScrollPixels': 180,
        'preloadScrollWaitMs': 450,
        'preloadStableRoundsLimit': 24,
        'preloadMaxRounds': 300,
        'preloadActivateCardEvery': 0,
        'preloadActivateCardWaitMs': 250,
    },
    'scoring': {
        'max_min_salary_k': 25,
        'title_block_keywords': {
            '测试': 100,
            '销售': 100,
            '商务': 100,
            '运营': 100,
            '客服': 100,
            '管培生': 100,
            '培训生': 100,
            '储备干部': 100,
            '储干': 100,
            '项目经理': 100,
            '项目管理': 100,
            '产品经理': 100,
            '产品运营': 100,
            '数据开发': 100,
            '数据治理': 100,
            '计算机视觉': 100,
            '视觉算法': 100,
            'cv算法': 100,
            '图像算法': 100,
            '图像处理': 100,
            '自动驾驶': 100,
            'slam': 100,
            '嵌入式': 100,
            '硬件': 100,
            '渠道': 100,
            '光伏': 100,
        },
        'title_penalty_keywords': {
            'java': 35,
            '前端': 45,
            '全栈': 12,
            'c++': 18,
            'golang': 20,
            'go语言': 20,
            '推荐算法': 28,
            '广告算法': 32,
            '搜索算法': 12,
            '量化': 24,
            '运维': 32,
            'sre': 35,
            'devops': 30,
            '实施': 25,
        },
        'title_strong_keywords': {
            '大模型算法工程师': 98,
            '大模型应用工程师': 98,
            '大模型开发工程师': 96,
            '大模型工程师': 96,
            'llm工程师': 96,
            'aigc算法工程师': 94,
            'ai算法工程师': 94,
            'nlp算法工程师': 94,
            '自然语言处理工程师': 92,
            '机器学习工程师': 92,
            '机器学习算法': 90,
            '深度学习工程师': 90,
            '模型微调工程师': 94,
            '大模型训练工程师': 92,
            'agent工程师': 96,
            'ai agent': 94,
            '智能体工程师': 96,
            '智能体开发': 94,
            'rag工程师': 96,
            '检索算法工程师': 88,
            'ai应用工程师': 96,
            '人工智能应用工程师': 94,
            'ai研发工程师': 92,
            '人工智能工程师': 90,
            '金融大模型': 96,
            '金融ai': 92,
            '多模态大模型': 92,
        },
        'title_medium_keywords': {
            '算法工程师': 42,
            '算法研究员': 44,
            '算法': 34,
            '大模型': 86,
            'llm': 84,
            'aigc': 82,
            'ai': 68,
            '机器学习': 76,
            '深度学习': 74,
            'nlp': 78,
            '自然语言处理': 78,
            'agent': 80,
            '智能体': 82,
            'rag': 80,
            '检索': 68,
            '知识库': 64,
            '模型训练': 72,
            '模型研发': 72,
            '模型微调': 80,
            '微调': 78,
            '多模态': 76,
            '数据科学': 72,
            '数据挖掘': 68,
            'python': 58,
        },
        'detail_infra_keywords': {
            'ai agent': 10,
            '智能体': 10,
            'agent': 8,
            'tool calling': 10,
            'function calling': 10,
            'mcp': 8,
            'query schema': 10,
            '语义解析': 8,
            '意图识别': 8,
            '语义路由': 8,
            '模型路由': 8,
            'trace': 6,
            '评测集': 8,
            '评测体系': 8,
            '模型评估': 6,
            'rag': 10,
            '检索增强': 10,
            '混合检索': 10,
            '向量检索': 8,
            'bge': 10,
            'rerank': 10,
            '重排序': 10,
            'embedding': 8,
            '文档切分': 8,
            '知识库': 6,
            'lora': 10,
            'qlora': 10,
            'peft': 10,
            'sft': 8,
            '模型微调': 10,
            '大模型': 8,
            'llm': 8,
            'scikit-learn': 8,
            'sklearn': 8,
            'lightgbm': 10,
            'xgboost': 10,
            'pytorch': 10,
            '特征工程': 8,
            '时序验证': 8,
            'spark': 8,
            'hive': 8,
            '分布式计算': 8,
        },
        'detail_support_keywords': {
            'python': 8,
            'fastapi': 6,
            'api': 4,
            '服务化': 6,
            '部署': 5,
            'docker': 5,
            'kubernetes': 4,
            '提示词工程': 6,
            'prompt': 5,
            '流式输出': 6,
            'token': 6,
            '模型调度': 6,
            '低幻觉': 5,
            '可解释': 5,
            '分类': 4,
            '回归': 4,
            '模型解释': 5,
            '泛化': 5,
            '数据清洗': 4,
            '特征提取': 5,
            '批处理': 5,
            '金融': 6,
            '财报': 6,
            '资本市场': 6,
        },
        'detail_negative_keywords': {
            'spring': 14,
            'spring boot': 16,
            'react': 16,
            'vue': 16,
            'android': 12,
            'ios': 12,
            '小程序': 12,
            'java': 14,
            'c++': 10,
            'golang': 10,
            'go语言': 10,
            'rust': 10,
            'opencv': 16,
            'yolo': 16,
            '目标检测': 16,
            '图像分割': 16,
            'slam': 18,
            '自动驾驶': 18,
            '推荐系统': 10,
            'ctr': 12,
            'cvr': 12,
            '嵌入式': 16,
            '硬件': 14,
            '值班': 10,
            '渠道': 12,
            '销售': 12,
            '新能源': 12,
            '光伏': 16,
        },
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        elif value is not None:
            result[key] = value
    return result


def _apply_legacy_compat(config: dict, user_config: dict) -> dict:
    legacy_top_level_to_nested = {
        'job_score_delay_base_ms': ('backend', 'job_score_delay_base_ms'),
        'job_score_delay_jitter_ms': ('backend', 'job_score_delay_jitter_ms'),
        'thread': ('frontend', 'thread'),
    }
    for old_key, (group, new_key) in legacy_top_level_to_nested.items():
        if old_key in user_config and user_config[old_key] is not None:
            config[group][new_key] = user_config[old_key]
    return config


def _load_raw_user_config():
    config_path = 'user_config.json'
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            user_config = json.load(f)
        if isinstance(user_config, dict):
            return user_config
    return {}


def load_user_config():
    config = copy.deepcopy(DEFAULT_USER_CONFIG)
    user_config = RAW_USER_CONFIG
    if isinstance(user_config, dict) and user_config:
        config = _deep_merge(config, user_config)
        config = _apply_legacy_compat(config, user_config)
    return config


RAW_USER_CONFIG = _load_raw_user_config()
USER_CONFIG = load_user_config()


class Config:
    introduce = USER_CONFIG['introduce']
    tags = USER_CONFIG['tags']

    job_score_delay_base_ms = USER_CONFIG['backend']['job_score_delay_base_ms']
    job_score_delay_jitter_ms = USER_CONFIG['backend']['job_score_delay_jitter_ms']

    max_min_salary_k = USER_CONFIG['scoring']['max_min_salary_k']
    title_block_keywords = USER_CONFIG['scoring']['title_block_keywords']
    title_penalty_keywords = USER_CONFIG['scoring']['title_penalty_keywords']
    title_strong_keywords = USER_CONFIG['scoring']['title_strong_keywords']
    title_medium_keywords = USER_CONFIG['scoring']['title_medium_keywords']
    detail_infra_keywords = USER_CONFIG['scoring']['detail_infra_keywords']
    detail_support_keywords = USER_CONFIG['scoring']['detail_support_keywords']
    detail_negative_keywords = USER_CONFIG['scoring']['detail_negative_keywords']

    frontend = USER_CONFIG['frontend']
    backend = USER_CONFIG['backend']
    scoring = USER_CONFIG['scoring']
    schedule = USER_CONFIG['schedule']

    @classmethod
    def get_client_config(cls):
        return {
            'introduce': cls.introduce,
            'tags': cls.tags,
            'frontend': cls.frontend,
            'schedule': cls.schedule,
        }

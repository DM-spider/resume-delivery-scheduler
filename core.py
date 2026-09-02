from config import Config
import re


def __extract_job_fields(job: str) -> tuple[str, str, str]:
    """从脚本上传的文本中提取岗位名称、薪资和职位描述。"""
    sections = [section.strip() for section in re.split(r'\n\s*\n', job) if section.strip()]
    title = ''
    salary = ''
    detail = job.strip()
    if sections:
        title_lines = sections[0].splitlines()
        if len(title_lines) > 1:
            title = '\n'.join(title_lines[1:]).strip()
    if len(sections) >= 2:
        salary_lines = sections[1].splitlines()
        if len(salary_lines) > 1:
            salary = '\n'.join(salary_lines[1:]).strip()
    if len(sections) >= 3:
        detail_lines = '\n\n'.join(sections[2:]).splitlines()
        if len(detail_lines) > 1:
            detail = '\n'.join(detail_lines[1:]).strip()
    return title, salary, detail


def __extract_salary_min_k(salary: str) -> float | None:
    """提取 Boss 常见 K 制月薪的区间下限；无法确认时不做薪资拦截。"""
    normalized = salary.replace(',', '').strip()
    range_match = re.search(
        r'(\d+(?:\.\d+)?)\s*(?:-|~|～|—|–|至)\s*\d+(?:\.\d+)?\s*[kK]',
        normalized,
    )
    if range_match:
        return float(range_match.group(1))
    single_match = re.search(r'(\d+(?:\.\d+)?)\s*[kK](?:\s*(?:以上|起|起薪))?', normalized)
    if single_match:
        return float(single_match.group(1))
    return None


def __normalize_text(text: str) -> str:
    return text.lower()


def __find_matches(text: str, keyword_scores: dict[str, int]) -> list[tuple[str, int]]:
    normalized = __normalize_text(text)
    matches = []
    for keyword, score in keyword_scores.items():
        if keyword.lower() in normalized:
            matches.append((keyword, score))
    return matches


def evaluateJobMatch(job: str):
    """返回岗位匹配明细，便于日志排查。"""
    title, salary, detail = __extract_job_fields(job)
    salary_min_k = __extract_salary_min_k(salary)
    if salary_min_k is not None and salary_min_k > Config.max_min_salary_k:
        return {
            'title': title,
            'salary': salary,
            'salary_min_k': salary_min_k,
            'detail': detail,
            'matched_field': 'salary_negative',
            'keyword': f'{salary_min_k:g}K',
            'score': 0,
            'blocked': True,
            'title_score': 0,
            'detail_score': 0,
            'penalty_score': 0,
            'title_penalty_score': 0,
            'combo_score': 0,
            'final_score': 0,
            'title_match_level': 'none',
            'title_matches': [],
            'title_penalty_matches': [],
            'detail_infra_matches': [],
            'detail_support_matches': [],
            'detail_negative_matches': [],
            'reason': f'岗位最低薪资 {salary_min_k:g}K 超过限制 {Config.max_min_salary_k:g}K',
        }
    title_block_matches = __find_matches(title, Config.title_block_keywords)
    if title_block_matches:
        return {
            'title': title,
            'salary': salary,
            'salary_min_k': salary_min_k,
            'detail': detail,
            'matched_field': 'title_negative',
            'keyword': title_block_matches[0][0],
            'score': 0,
            'blocked': True,
            'title_score': 0,
            'detail_score': 0,
            'penalty_score': 0,
            'title_penalty_score': 0,
            'combo_score': 0,
            'final_score': 0,
            'title_match_level': 'negative',
            'title_matches': [keyword for keyword, _ in title_block_matches],
            'title_penalty_matches': [],
            'detail_infra_matches': [],
            'detail_support_matches': [],
            'detail_negative_matches': [],
            'reason': '岗位名称命中强负向关键词',
        }

    detail_block_matches = __find_matches(detail, Config.detail_block_keywords)
    if detail_block_matches:
        return {
            'title': title,
            'salary': salary,
            'salary_min_k': salary_min_k,
            'detail': detail,
            'matched_field': 'detail_negative',
            'keyword': detail_block_matches[0][0],
            'score': 0,
            'blocked': True,
            'title_score': 0,
            'detail_score': 0,
            'penalty_score': 0,
            'title_penalty_score': 0,
            'combo_score': 0,
            'final_score': 0,
            'title_match_level': 'negative',
            'title_matches': [],
            'title_penalty_matches': [],
            'detail_infra_matches': [],
            'detail_support_matches': [],
            'detail_negative_matches': [keyword for keyword, _ in detail_block_matches],
            'reason': '职位描述命中校招或应届生强负向关键词',
        }

    title_strong_matches = __find_matches(title, Config.title_strong_keywords)
    title_medium_matches = __find_matches(title, Config.title_medium_keywords)
    title_match_level = 'none'
    title_keyword = None
    title_score = 0
    title_matches: list[str] = []

    if title_strong_matches:
        title_keyword, title_score = max(title_strong_matches, key=lambda item: item[1])
        title_match_level = 'strong'
        title_matches = [keyword for keyword, _ in title_strong_matches]
    elif title_medium_matches:
        title_keyword, title_score = max(title_medium_matches, key=lambda item: item[1])
        title_match_level = 'medium'
        title_matches = [keyword for keyword, _ in title_medium_matches]

    title_penalty_matches = __find_matches(title, Config.title_penalty_keywords)
    detail_infra_matches = __find_matches(detail, Config.detail_infra_keywords)
    detail_support_matches = __find_matches(detail, Config.detail_support_keywords)
    detail_negative_matches = __find_matches(detail, Config.detail_negative_keywords)

    detail_infra_score = min(sum(score for _, score in detail_infra_matches), 24)
    detail_support_score = min(sum(score for _, score in detail_support_matches), 12)
    detail_score = detail_infra_score + detail_support_score
    title_penalty_score = min(sum(score for _, score in title_penalty_matches), 45)
    penalty_score = min(sum(score for _, score in detail_negative_matches), 36)

    combo_score = 0
    infra_keywords = {keyword for keyword, _ in detail_infra_matches}
    detail_match_count = len(detail_infra_matches) + len(detail_support_matches)
    title_normalized = __normalize_text(title)

    if title_match_level == 'strong' and len(detail_infra_matches) >= 2:
        combo_score += 10
    if title_match_level == 'medium' and detail_match_count >= 3:
        combo_score += 10
    target_title_terms = ('大模型', 'llm', 'ai', '算法', '机器学习', '深度学习', 'nlp', '智能体', 'agent', 'rag')
    target_detail_terms = {
        '大模型', 'llm', '智能体', 'agent', 'ai agent', 'rag', '混合检索', 'bge', 'rerank',
        'lora', 'qlora', 'peft', 'pytorch', 'lightgbm', 'xgboost', 'scikit-learn', 'sklearn',
    }
    if any(term in title_normalized for term in target_title_terms) and infra_keywords.intersection(target_detail_terms):
        combo_score += 10
    financial_terms = ('金融', '银行', '证券', '基金', '财报', '资本市场')
    if any(term in title or term in detail for term in financial_terms) and infra_keywords.intersection(target_detail_terms):
        combo_score += 8

    raw_score = title_score + detail_score + combo_score - title_penalty_score - penalty_score
    if title_match_level == 'none':
        raw_score = min(raw_score, 55)
    final_score = max(0, min(100, raw_score))

    if title_match_level in ['strong', 'medium']:
        matched_field = 'title'
        keyword = title_keyword
        if title_penalty_matches:
            reason = '岗位名称命中正向关键词，但带有弱负向词扣分'
        else:
            reason = '岗位名称命中正向关键词'
    elif detail_infra_matches or detail_support_matches:
        matched_field = 'detail'
        keyword = (detail_infra_matches + detail_support_matches)[0][0]
        reason = '仅职位描述命中，已按标题缺失封顶'
    else:
        matched_field = 'none'
        keyword = None
        reason = '未命中有效关键词'

    return {
        'title': title,
        'salary': salary,
        'salary_min_k': salary_min_k,
        'detail': detail,
        'matched_field': matched_field,
        'keyword': keyword,
        'score': final_score,
        'blocked': False,
        'title_score': title_score,
        'detail_score': detail_score,
        'penalty_score': penalty_score,
        'title_penalty_score': title_penalty_score,
        'combo_score': combo_score,
        'final_score': final_score,
        'title_match_level': title_match_level,
        'title_matches': title_matches,
        'title_penalty_matches': [keyword for keyword, _ in title_penalty_matches],
        'detail_infra_matches': [keyword for keyword, _ in detail_infra_matches],
        'detail_support_matches': [keyword for keyword, _ in detail_support_matches],
        'detail_negative_matches': [keyword for keyword, _ in detail_negative_matches],
        'reason': reason,
    }

"""单元格级的纯函数解析（TD-01 §1、§3.7–§3.11）。

每个函数只看传入的值，不读 xlsx；问题通过 Issues 收集，交给构建报告。
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal


class Issues:
    """按类别收集解析问题：level 为 'error' | 'warn'，只有构建脚本认定的阻断项才会让构建失败"""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], list[str]] = defaultdict(list)

    def add(self, level: str, kind: str, where: str) -> None:
        self.items[(level, kind)].append(where)

    def count(self, level: str | None = None) -> int:
        return sum(len(v) for (lv, _), v in self.items.items() if level is None or lv == level)


def blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == '')


def as_num(x: float):
    """整数值的浮点数写成 int，生成文件更干净"""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


# ---------------------------------------------------------------------------
# §1.2 数值、§1.3 列表、§1.4 标记

_ARITH = re.compile(r'-?\d+(\.\d+)?([+-]\d+(\.\d+)?)+')


def parse_num(v, where: str, issues: Issues):
    if blank(v):
        return None
    if isinstance(v, bool):
        issues.add('warn', '类型异常', where)
        return None
    if isinstance(v, (int, float)):
        return as_num(v)
    s = str(v).strip()
    if s == '/':
        issues.add('warn', '斜杠占位', where)
        return None
    if re.fullmatch(r'-?\d+(\.\d+)?', s):
        return as_num(float(s)) if '.' in s else int(s)
    if _ARITH.fullmatch(s):
        issues.add('warn', '算术字符串', f'{where}: "{s}"')
        return as_num(float(sum(float(t) for t in split_top_terms(s))))
    issues.add('error', '数值无法解析', f'{where}: "{s}"')
    return None


def parse_list(v, where: str, issues: Issues):
    if blank(v):
        return None
    if isinstance(v, bool):
        issues.add('warn', '类型异常', where)
        return None
    if isinstance(v, float) and not v.is_integer():
        a, b = repr(v).split('.')
        issues.add('warn', '小数点当逗号', f'{where}: {v}')
        return [int(a), int(b)]
    if isinstance(v, (int, float)):
        return [int(v)]
    s = str(v).strip()
    if s == '/':
        issues.add('warn', '斜杠占位', where)
        return None
    if re.fullmatch(r'-?\d+(\s*[,，]\s*-?\d+)*', s):
        return [int(x) for x in re.split(r'[,，]', s)]
    issues.add('warn', '列表无法解析', f'{where}: "{s}"')
    return None


def parse_flag(v, where: str, issues: Issues):
    if blank(v):
        return None
    s = str(v).strip()
    if s == '√':
        return True
    if s == '×':
        return False
    issues.add('warn', '标记无法解析', f'{where}: "{s}"')
    return None


def sec_to_frames(sec: float, fps: int = 60) -> int:
    """§1.6 FunctionalFrame：四舍五入到整帧，不足半帧（含 0 秒）按 1 帧计"""
    x = sec * fps
    i = math.floor(x + 1e-9)
    return i + round_half_up(x - i) + (1 if 1 - sec >= 1 - 0.5 / fps else 0)


def round_half_up(x: float) -> int:
    return int(Decimal(repr(x)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------------------
# §3.7 资源列：公式项与"进入动作即得"

def split_top_terms(expr: str) -> list[str]:
    """把 "a+b-(c+d)" 拆成顶层加减项（负号留在项里），括号内整体算一项"""
    terms: list[str] = []
    depth, cur = 0, ''
    for ch in expr.replace(' ', ''):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch in '+-' and depth == 0 and cur != '':
            terms.append(cur)
            cur = '-' if ch == '-' else ''
            continue
        cur += ch
    if cur != '':
        terms.append(cur)
    return terms


def _eval_arith(expr: str) -> float:
    if not re.fullmatch(r'[\d.+\-*/() ]+', expr):
        raise ValueError(expr)
    return float(eval(expr, {'__builtins__': {}}, {}))  # noqa: S307 —— 只含数字与四则运算


def formula_text(f) -> str | None:
    """openpyxl 的公式可能是字符串或 ArrayFormula 对象"""
    t = getattr(f, 'text', f)
    return t if isinstance(t, str) and t.startswith('=') else None


def parse_gain(cached, formula, where: str, issues: Issues):
    """资源单元格 → GainCell（TD-01 §3.7）"""
    f = formula_text(formula)
    if isinstance(cached, str) and _ARITH.fullmatch(cached.strip()):   # 算术字符串（非公式），按多项公式处理
        issues.add('warn', '算术字符串', f'{where}: "{cached.strip()}"')
        f = '=' + cached.strip()
        cached = sum(_eval_arith(t) for t in split_top_terms(cached.strip()))
    total = parse_num(cached, where, issues)
    if total is None:
        return None
    if f is None:
        return {'total': total}
    body = f[1:]
    if re.fullmatch(r'\$?[A-Z]{1,3}\$?\d+', body):
        return {'total': total, 'ref': body.replace('$', '')}
    if re.fullmatch(r'[\d.+\-*/() ]+', body):
        terms = split_top_terms(body)
        vals = [as_num(round(_eval_arith(t), 10)) for t in terms]
        if abs(sum(vals) - total) > 1e-6:
            issues.add('error', '公式项之和与缓存值不符', f'{where}: {f} vs {total}')
        if len(vals) == 1:
            return {'total': total, 'formula': f}
        return {'total': total, 'perHit': vals[:-1], 'onAction': vals[-1], 'formula': f}
    # 查表：INDEX(dmg!…) 取的是 dmg 里同一判定的回收值（× 0.01 换单位），等同于直接写数字；
    # 查表之外还有常数项（"INDEX(…)*0.01+10"）时，按 §3.7 的约定拆成逐段 + 进入动作即得
    terms = split_top_terms(body)
    lookups = [k for k, t in enumerate(terms) if 'INDEX(dmg!' in t]
    literals = [k for k, t in enumerate(terms) if k not in lookups and re.fullmatch(r'[\d.+\-*/() ]+', t)]
    if len(lookups) == 1 and len(lookups) + len(literals) == len(terms):
        if len(terms) == 1:
            return {'total': total}
        vals = [0.0] * len(terms)
        for k in literals:
            vals[k] = _eval_arith(terms[k])
        vals[lookups[0]] = total - sum(vals[k] for k in literals)
        vals = [as_num(round(v, 10)) for v in vals]
        return {'total': total, 'perHit': vals[:-1], 'onAction': vals[-1], 'formula': f}
    issues.add('warn', '复杂资源公式', f'{where}: {f[:60]}')
    return {'total': total, 'formula': f, 'complex': True}


# ---------------------------------------------------------------------------
# §3.8 备注提示（v0.1.2：并列写法拆开逐项匹配）

_HINTS = [
    (re.compile(r'每\s*(\d+)\s*F\s*进行一次判定[，,]?\s*最多\s*(\d+)\s*次'),
     lambda m: {'tickInterval': int(m.group(1)), 'maxTicks': int(m.group(2))}),
    (re.compile(r'每\s*(\d+)\s*F\s*进行一次判定'), lambda m: {'tickInterval': int(m.group(1))}),
    (re.compile(r'第\s*(\d+)\s*F\s*触发上一角色延奏'), lambda m: {'outroTriggerFrame': int(m.group(1))}),
    (re.compile(r'第\s*(\d+(?:\s*F?\s*[、,，]\s*\d+)*)\s*F\s*改变(?:中断)?优先级'),
     lambda m: {'priorityChangeFrames': [int(x) for x in re.findall(r'\d+', m.group(1))]}),
    (re.compile(r'无伤害'), lambda m: {'noDamage': True}),
    (re.compile(r'延迟生成飞行道具'), lambda m: {'delayedProjectile': True}),
    (re.compile(r'判定存在\s*(\d+)\s*F'), lambda m: {'existsFrames': int(m.group(1))}),
    (re.compile(r'(地面|空中)出场技复用'), lambda m: {'reuses': m.group(1) + '出场技'}),
]
_LOCK = re.compile(r'第\s*(\d+)\s*F\s*前((?:不响应输入|不能)[^；;。，,|\n]*)')
_LOCK_KEYS = {'不响应输入': 'noInputBefore', '不能闪避': 'noDodgeBefore', '不能切人': 'noSwitchBefore'}


def extract_hints(note: str | None) -> dict:
    if not note:
        return {}
    h: dict = {}
    for rx, fn in _HINTS:
        if 'tickInterval' in h and rx.pattern.startswith('每') and 'maxTicks' not in rx.pattern:
            continue
        m = rx.search(note)
        if m:
            h.update(fn(m))
    for m in _LOCK.finditer(note):
        n, verb = int(m.group(1)), '不能'
        for item in m.group(2).split('、'):
            item = item.strip()
            if item.startswith('不响应'):
                verb, key = '不响应', item
            elif item.startswith('不能'):
                verb, key = '不能', item
            else:
                key = verb + item                     # "不能闪避、跳跃" 的 "跳跃" 沿用前一项的动词
            k = _LOCK_KEYS.get(key)
            if k and k not in h:
                h[k] = n
    return h


# ---------------------------------------------------------------------------
# §3.9 行名里的变体标记

def name_tags(name: str) -> dict:
    t: dict = {}
    m = re.search(r'(?<![A-Za-z])C(\d)(?!\d)', name)
    if m:
        t['chain'] = int(m.group(1))
    m = re.search(r'(?<![A-Za-z])P(\d)(?!\d)', name)
    if m:
        t['passive'] = int(m.group(1))
    if name.endswith('D') and not name.endswith('HUD'):
        t['dodgeCounter'] = True
    m = re.search(r'-(前|后)$', name)
    if m:
        t['dir'] = m.group(1)
    return t


# ---------------------------------------------------------------------------
# §3.11 出生帧：发生帧公式 P + f(Q) 的 P

def _roundup(x, d=0):
    return math.ceil(x - 1e-12) if x >= 0 else -math.ceil(-x - 1e-12)


def _round(x, d=0):
    return float(Decimal(repr(x)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def eval_frame_formula(f: str, fps: int = 60, half: float = 0.5) -> float:
    """求值发生帧公式（只认作者用的秒 → 帧写法：ROUNDUP / ROUND / INT / IF / MOD 与四则运算）"""
    e = f.lstrip('=').replace('base!$B$2', str(fps)).replace('base!$C$2', str(half))
    e = re.sub(r'\bROUNDUP\(', '_ru(', e)
    e = re.sub(r'\bROUND\(', '_rd(', e)
    e = re.sub(r'\bINT\(', '_int(', e)
    e = re.sub(r'\bIF\(', '_if(', e)
    e = re.sub(r'\bMOD\(', '_mod(', e)
    e = re.sub(r'(?<![<>=!])=(?!=)', '==', e)
    e = e.replace('<>', '!=')
    if re.search(r'[A-Za-z_$!]', re.sub(r'_(ru|rd|int|if|mod)\(|==|!=|<=|>=', '', e)):
        raise ValueError(f)
    env = {'_ru': _roundup, '_rd': _round, '_int': math.floor, '_if': lambda c, a, b: a if c else b,
           '_mod': lambda a, b: a - b * math.floor(a / b), '__builtins__': {}}
    return float(eval(e, env, {}))  # noqa: S307 —— 已剔除一切标识符


_SEC_EXPR = re.compile(r'(\((?:[^()]|\([^()]*\))*\)|[\d.]+)\*base!\$B\$2')


def extract_birth_frame(formula, spawn_frame) -> int | None:
    """P + f(Q) 形式时返回 P 的帧（小于发生帧才返回），否则 None（TD-01 §3.11）"""
    f = formula_text(formula)
    if f is None or spawn_frame is None:
        return None
    m = _SEC_EXPR.search(f)
    if not m or not m.group(1).startswith('('):
        return None
    terms = split_top_terms(m.group(1)[1:-1])
    if len(terms) < 2:
        return None
    try:
        birth = eval_frame_formula(f.replace(m.group(1), '(' + terms[0] + ')'))
    except (ValueError, SyntaxError, ZeroDivisionError):
        return None
    b = int(round(birth))
    return b if b < spawn_frame else None

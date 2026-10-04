"""golden 抽取：「伤害计算」页的标准答案（TD-01 §11.1）与逐格乘区拆分（TD-03 §10）。

- golden_damage：R3 的面板与目标（context）+ R4–R1026 各列组的条目 → fixtures/golden-damage.json
- golden_zones：每个标准答案格的数组公式按乘号拆成因子、按 TD-03 §10.2 归类 → fixtures/golden-zones.json

乘区值的写法保证 TS 侧能逐位还原每个因子（tests/td03.test.ts T03-9）：因子 V = (1 + …) 记 x，使 1 + x 与 V 逐位相等
（优先取"1 之外各项之和"，不等时取 V − 1）；无视防御 V = (1 − …) 同理；`(1 − MIN(x, 1))` 与抗性直接记 x。
"""
from __future__ import annotations

import math
import re
from collections import Counter

from xlformula import Evaluator, Node, Ref, XlError, col_index, col_letter, split_coord, strip_paren, to_bool

CALC = '伤害计算'
CFG = '伤害配置'
SHEETS = (CALC, CFG, 'dmg', 'base', 'prop')        # 标准答案公式引用到的表
GROUP_STARTS = ('B', 'H', 'N', 'T', 'Z')          # 列组起点：名称 | 空 | 未暴击 | 暴击 | 结算次数
FIRST_ROW, LAST_ROW = 4, 1026                     # 角色块（TD-01 §11.1）；末行按 A 列"其他"定位，这里是 20260707 版的值
TABLE_ROWS = (1039, 1106)                         # 异常效应逐层表、谐度破坏表（TD-03 §9.1）；按表头定位，同上
# 「伤害配置」各段：A 列段名 → 20260707 版段首的行。下文写的「伤害配置」行号都是 20260707 版的，用时按所在段的段首平移
# （Classifier.r）：xlsx 插行不影响。20261003 版整体下移 117 行，面板之后又多 2 行
CFG_SECTIONS = {'def': 1792, 'def99': 1817, 'dmgchg': 1867, 'dmgrd': 1892, 'dmgampl1-9(37&38)': 1917,
                'dmgpost0_6(127&128)': 2025, 'dmgampl0(37&38)': 2114, 'dmgamplxxxx(37&38)': 2139, '面板': 2147,
                '聚爆效应121': 2621}
SECTION_TAIL = re.compile(r'(\d+级|已激活|未激活|技能)$')


def calc_layout(values: dict) -> tuple[int, int, int]:
    """「伤害计算」各段的行：(角色块末行, 两张表的首行, 末行)。角色块到 A 列"其他"的上一行；表从 B 列"光噪效应（对目标）"起，
    到谐度破坏表（B 列"谐度破坏"、D 列"倍率"的表头）连续有行名的最后一行。找不到的按 20260707 版"""
    text = lambda c: str(values.get(c) or '').strip()          # noqa: E731
    rows = sorted({split_coord(k)[1] for k in values})
    other = next((r for r in rows if text(f'A{r}') == '其他'), None)
    lo = next((r for r in rows if text(f'B{r}') == '光噪效应（对目标）'), TABLE_ROWS[0])
    hi = next((r for r in rows if text(f'B{r}') == '谐度破坏' and values.get(f'D{r}') == '倍率'), None)
    if hi is None:
        hi = TABLE_ROWS[1]
    else:
        while text(f'B{hi + 1}'):
            hi += 1
    return (other - 1 if other else LAST_ROW), lo, hi


def cfg_shifts(cfg: dict) -> dict[int, int]:
    """「伤害配置」各段段首比 20260707 版下移了几行：{20260707 版段首: 下移行数}；A 列找不到段名的不在里面"""
    out = {}
    for coord, v in cfg.items():
        if coord[0] == 'A' and coord[1:].isdigit() and isinstance(v, str) and v.strip() in CFG_SECTIONS:
            old = CFG_SECTIONS[v.strip()]
            out[old] = int(coord[1:]) - old
    return out


def _cols(start: str) -> tuple[str, str, str]:
    c = col_index(start)
    return col_letter(c + 2), col_letter(c + 3), col_letter(c + 4)   # 未暴击、暴击、结算次数


# ---------------------------------------------------------------------------
# TD-01 §11.1 标准答案


def golden_damage(values: dict, current_char: str | None, dmg_by_calc: dict[tuple[str, str], list[str]]) -> dict:
    """values：「伤害计算」页缓存值 {坐标: 值}；current_char：计算器当前角色（伤害配置!B3）；
    dmg_by_calc：(charaId, dmgCalc) → [dmg 行名…]"""
    head = {c: values.get(f'{col_letter(c)}2') for c in range(1, 31)}
    row3 = {c: values.get(f'{col_letter(c)}3') for c in range(1, 31)}
    panel = {str(head[c]): row3[c] for c in range(2, 16)                        # B–O：角色实时面板
             if head[c] is not None and isinstance(row3[c], (int, float)) and not isinstance(row3[c], bool)}
    target = {str(head[c]): row3[c] for c in range(17, 31)                      # Q–AD：目标实时面板
              if head[c] is not None and row3[c] is not None}
    entries = []
    char = None
    sections: dict[str, str | None] = {}
    last, _, _ = calc_layout(values)
    for r in range(FIRST_ROW, last + 1):
        a = values.get(f'A{r}')
        if isinstance(a, str) and a.strip():
            char, sections = a.strip(), {}
        if char is None:
            continue
        for start in GROUP_STARTS:
            nc_col, cr_col, tk_col = _cols(start)
            label = values.get(f'{start}{r}')
            if label is None or (isinstance(label, str) and not label.strip()):
                continue
            nc, cr = values.get(f'{nc_col}{r}'), values.get(f'{cr_col}{r}')
            if nc == '未暴击':                                   # 小节标题
                if isinstance(label, str) and SECTION_TAIL.search(label.strip()):
                    sections[start] = label.strip()
                continue
            if not isinstance(nc, (int, float)) or isinstance(nc, bool):
                continue
            label = str(label).strip()
            tk = values.get(f'{tk_col}{r}')
            e = {'char': char, 'section': sections.get(start), 'label': label, 'nonCrit': nc,
                 'crit': cr if isinstance(cr, (int, float)) and not isinstance(cr, bool) else None,
                 'ticks': tk if isinstance(tk, (int, float)) and not isinstance(tk, bool) else None,
                 'row': r, 'col': start}
            hits = dmg_by_calc.get((char, label), [])
            if len(hits) == 1:
                e['dmgKey'] = [char, hits[0]]
            entries.append(e)
    return {'context': {'char': current_char or '', 'panel': panel, 'target': target}, 'entries': entries}


def sheet_values(ws) -> dict:
    """整张表的缓存值 {坐标: 值}（只留非空格）；ws 来自 data_only 的工作簿"""
    out = {}
    for r, row in enumerate(ws.iter_rows(values_only=True), start=1):
        for c, v in enumerate(row, start=1):
            if v is not None:
                out[f'{col_letter(c)}{r}'] = v
    return out


def sheet_formulas(ws) -> dict:
    """整张表的公式原文 {坐标: '=…'}；数组公式取其文本"""
    out = {}
    for r, row in enumerate(ws.iter_rows(values_only=True), start=1):
        for c, v in enumerate(row, start=1):
            if v is not None:
                out[f'{col_letter(c)}{r}'] = getattr(v, 'text', v)
    return out


def dmg_by_calc(dmg_values: dict) -> dict[tuple[str, str], list[str]]:
    """dmg 表：(charaId, Skill.DmgCalc) → [行名…]（A、C、B 列，第 3 行起）"""
    out: dict[tuple[str, str], list[str]] = {}
    rows = sorted({int(k[1:]) for k in dmg_values if k[:1] == 'A' and k[1:].isdigit()})
    for r in rows:
        if r < 3:
            continue
        a, b, c = dmg_values.get(f'A{r}'), dmg_values.get(f'B{r}'), dmg_values.get(f'C{r}')
        if a is None or b is None or c is None or not str(c).strip():
            continue
        names = out.setdefault((str(a).strip(), str(c).strip()), [])
        if str(b).strip() not in names:
            names.append(str(b).strip())
    return out


def clean(x):
    """整数值的浮点数写成整数，生成文件更干净"""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x]
    return x


# ---------------------------------------------------------------------------
# TD-03 §10 乘区拆分

def _is_num(n: Node, v: float | None = None) -> bool:
    return n.kind == 'num' and (v is None or n.value == v)


def _mul_factors(n: Node) -> list[Node]:
    """按乘号拆成因子；只含乘号的括号继续拆，含倍率 INDEX 的括号整体算基础项"""
    if n.kind == 'bin' and n.value == '*':
        return _mul_factors(n.args[0]) + _mul_factors(n.args[1])
    if n.kind == 'paren':
        inner = strip_paren(n)
        if inner.kind == 'bin' and inner.value == '*' and not _has_rate_index(inner):
            return _mul_factors(inner)
    return [n]


def _muldiv_terms(n: Node, exp: int = 1) -> list[tuple[Node, int]]:
    """乘除链 → [(因子, ±1)]"""
    n2 = strip_paren(n) if n.kind == 'paren' and strip_paren(n).kind == 'bin' and strip_paren(n).value in '*/' else n
    if n2.kind == 'bin' and n2.value in ('*', '/'):
        return _muldiv_terms(n2.args[0], exp) + _muldiv_terms(n2.args[1], exp if n2.value == '*' else -exp)
    return [(n, exp)]


def _addsub_terms(n: Node, sign: int = 1) -> list[tuple[Node, int]]:
    """加减链 → [(项, ±1)]，按原文顺序"""
    if n.kind == 'bin' and n.value in ('+', '-'):
        return _addsub_terms(n.args[0], sign) + _addsub_terms(n.args[1], sign if n.value == '+' else -sign)
    if n.kind == 'paren' and strip_paren(n).kind == 'bin' and strip_paren(n).value in ('+', '-') and sign == 1:
        return _addsub_terms(strip_paren(n), sign)
    return [(n, sign)]


def _one_plus(n: Node) -> tuple[bool, int]:
    """形如 (1 + …) / (… + 1) / (1 − …)：返回 (是否, 1 之后第一个运算的符号)"""
    terms = _addsub_terms(strip_paren(n))
    if len(terms) < 2:
        return False, 0
    ones = [i for i, (t, s) in enumerate(terms) if _is_num(t, 1) and s == 1]
    if not ones:
        return False, 0
    i = ones[0]
    nxt = terms[i + 1][1] if i + 1 < len(terms) else terms[0][1]
    return True, nxt


def _walk(n: Node):
    yield n
    for a in n.args:
        yield from _walk(a)


def _has_rate_index(n: Node) -> bool:
    return any(x.kind == 'fn' and x.value == 'INDEX' and x.args and x.args[0].kind == 'ref'
               and x.args[0].value.sheet in ('dmg', 'base') for x in _walk(n))


def _cfg_cells(n: Node, here: str) -> list[tuple[int, int]]:
    """因子里引用到的「伤害配置」单元格 (列, 行)，按原文顺序"""
    out = []
    for x in _walk(n):
        if x.kind == 'ref' and (x.value.sheet or here) == CFG and x.value.r1 is not None:
            ref: Ref = x.value
            out.append((ref.c1, ref.r1))
    return out


def _grid_class(values: dict, col: int, row: int) -> int | None:
    """分区网格：数值行上面一行是代码（`冰A3`、`SS聚爆_6`），末尾数字是类别（TD-03 §9.2）"""
    code = values.get(f'{col_letter(col)}{row - 1}')
    if isinstance(code, str):
        m = re.search(r'_?(\d+)C?$', code.strip())
        if m:
            return int(m.group(1))
    return None


class Classifier:
    """把一个标准答案格的数组公式拆成 GoldenZone（TD-03 §10.2）"""

    def __init__(self, ev: Evaluator) -> None:
        self.ev = ev
        self.cfg = ev.values.get(CFG, {})
        self.shift = cfg_shifts(self.cfg)
        # base 页的列按第 55 行表头认（xlsx 会插列）；没有表头的（测试的迷你工作簿）按 20260707 版：AO 谐度破坏、AN 异常效应
        hdr = {}
        for coord, v in ev.values.get('base', {}).items():
            c, r = split_coord(coord)
            if r == 55 and isinstance(v, str):
                hdr[c] = v.strip()
        self.base_names = hdr or {col_index('AO'): 'WeaknessDamageBaseValue', col_index('AN'): 'AbnomalDamage'}

    def r(self, row: int) -> int:
        """20260707 版「伤害配置」的行号 → 这份 xlsx 的行号：按所在段的段首平移（找不到段名就不动）"""
        head = max((v for v in CFG_SECTIONS.values() if v <= row), default=None)
        return row + self.shift.get(head, 0) if head is not None else row

    def val(self, n: Node, here: str) -> float:
        return self.ev.number(n, here)

    def plus_x(self, t: Node, here: str) -> float:
        """因子 V = (1 + …)：返回 x，使 1 + x 逐位等于 V。优先用"1 之外各项之和"（好读），不等时退回 V − 1"""
        v = self.val(t, here)
        rest = _addsub_terms(strip_paren(t))
        for i, (n, sg) in enumerate(rest):
            if _is_num(n, 1) and sg == 1:
                del rest[i]
                break
        x = 0.0
        for n, sg in rest:
            x = x + sg * self.val(n, here)
        return x if 1 + x == v else v - 1

    def minus_x(self, t: Node, here: str) -> float:
        """因子 V = (1 − …)：返回 x，使 1 − x 逐位等于 V"""
        v = self.val(t, here)
        terms = _addsub_terms(strip_paren(t))[1:]
        x = 0.0
        for n, sg in terms:
            x = x - sg * self.val(n, here)
        return x if 1 - x == v else 1 - v

    # --- 各类因子
    def def_parts(self, n: Node, here: str, z: dict, notes: list[str]) -> bool:
        """MIN(2, 1 / (X + 1))：X 按乘除拆成 目标防御 × (1 + 防御±%) × (1 − 无视) / (800 + 8·Lv)"""
        s = strip_paren(n)
        if not (s.kind == 'fn' and s.value == 'MIN' and len(s.args) == 2 and _is_num(s.args[0], 2)):
            return False
        q = strip_paren(s.args[1])
        if not (q.kind == 'bin' and q.value == '/' and _is_num(q.args[0], 1)):
            return False
        d = strip_paren(q.args[1])
        if not (d.kind == 'bin' and d.value == '+' and _is_num(d.args[1], 1)):
            return False
        td = None
        rate = ignore = level = None
        for t, e in _muldiv_terms(d.args[0]):
            st = strip_paren(t)
            terms = _addsub_terms(st)
            if e < 0 and terms and _is_num(terms[0][0], 800):
                level = (self.val(t, here) - 800) / 8
                continue
            if e > 0 and t.kind == 'paren':
                ok, sign = _one_plus(t)
                if ok and _is_num(terms[0][0], 1):
                    if sign > 0:
                        x = self.plus_x(t, here)
                        rate = x if rate is None else (1 + rate) * (1 + x) - 1
                    else:
                        x = self.minus_x(t, here)
                        ignore = x if ignore is None else 1 - (1 - ignore) * (1 - x)
                    continue
            v = self.val(t, here)
            td = v if td is None else (td * v if e > 0 else td / v)
        if td is None or level is None:
            notes.append('防御因子形状不认识')
            return False
        z['def'] = {'targetDef': td, 'defRate': rate or 0.0, 'ignore': ignore or 0.0, 'level': level}
        return True

    def res_r(self, n: Node, here: str) -> float | None:
        """IF(r <= 0, 1 − r/2, IF(r < 0.8, 1 − r, 1 / (1 + 5r)))：返回 r"""
        s = strip_paren(n)
        if s.kind == 'fn' and s.value == 'IF' and s.args:
            c = strip_paren(s.args[0])
            if c.kind == 'bin' and c.value == '<=' and _is_num(c.args[1], 0):
                return self.val(c.args[0], here)
        return None

    def cell_formula(self, col: int, row: int) -> Node | None:
        src = self.ev.formulas.get(CFG, {}).get(f'{col_letter(col)}{row}')
        return self.ev.parsed(src) if isinstance(src, str) and src.startswith('=') else None

    # --- 主流程
    def classify(self, cell: str, src: str, name: str, branch: str) -> tuple[dict | None, str | None, list[str]]:
        """返回 (GoldenZone, 跳过原因, 备注)。跳过：护盾、白条削减（TD-03 §1.2 未纳入）"""
        here = CALC
        root = strip_paren(self.ev.parsed(src))
        if not (root.kind == 'fn' and root.value == 'CEILING'):
            return None, '不是 CEILING', []
        notes: list[str] = []
        z: dict = {}
        g: dict = {'cell': cell, 'name': name, 'branch': branch}
        other = None
        dr_seen = 0
        kind = None
        todo = _mul_factors(root.args[0])
        i = 0
        while todo:
            f = todo.pop(0)
            i += 1
            s = strip_paren(f)
            # 按状态切换整组乘区的 IF(条件, A, B)（洛瑟菈、椿…）：先算条件，再拆选中的分支（TD-03 §10.1 第 3 步）
            if s.kind == 'fn' and s.value == 'IF' and len(s.args) == 3 and self.res_r(f, here) is None \
                    and not _has_rate_index(s):
                pick = s.args[1] if to_bool(self.ev.scalar(s.args[0], here)) else s.args[2]
                todo[:0] = _mul_factors(pick)
                continue
            cfg = _cfg_cells(f, here)
            first = cfg[0] if cfg else None
            # 基础项
            if 'base' not in z and _has_rate_index(f):
                z['base'] = self.val(f, here)
                self.base_info(f, here, g)
                refs = [x.value for x in _walk(f) if x.kind == 'ref' and x.value.sheet in ('dmg', 'base')]
                cols = {(r.sheet, col_letter(r.c1)) for r in refs}
                names = {self.base_names.get(r.c1) for r in refs if r.sheet == 'base'}
                kind = 'tune' if 'WeaknessDamageBaseValue' in names else 'abnormal' if 'AbnomalDamage' in names \
                    else 'whitebar' if ('dmg', 'CZ') in cols else None
                continue
            if _is_num(s):
                if s.value == 1:
                    z.setdefault('crit', 1.0)
                    continue
                other = (other or 1.0) * s.value
                notes.append(f'数字因子 {s.value}')
                continue
            if self.def_parts(f, here, z, notes):
                continue
            r = self.res_r(f, here)
            if r is not None:
                z['res'] = r
                continue
            # (1 − MIN(x, 1))：第一个 dr，第二个 dre
            if s.kind == 'bin' and s.value == '-' and _is_num(s.args[0], 1):
                m = strip_paren(s.args[1])
                if m.kind == 'fn' and m.value == 'MIN' and len(m.args) == 2 and _is_num(m.args[1], 1):
                    z['dr' if dr_seen == 0 else 'dre'] = self.val(m.args[0], here)
                    dr_seen += 1
                    continue
                b = strip_paren(s.args[1])
                if b.kind == 'ref' and b.value.sheet == 'base' and col_letter(b.value.c1) == 'B' and b.value.r1 == 7:
                    z['vsNormal'] = True
                    continue
            # 直接引用预先算好的格：R1792–R1815 防御 / 抗性系数，R2139–R2142 霜冻 1002 类，暴伤格
            if s.kind == 'ref' and first:
                c, rw = first
                if self.r(1792) <= rw <= self.r(1815):
                    inner = self.cell_formula(c, rw)
                    ref_txt = f'{CFG}!{col_letter(c)}{rw}'
                    if c <= col_index('L'):
                        if inner is not None and self.def_parts(inner, CFG, z, notes):
                            g['defRef'] = ref_txt
                            continue
                    else:
                        rr = self.res_r(inner, CFG) if inner is not None else None
                        if rr is not None:
                            z['res'] = rr
                            g['resRef'] = ref_txt
                            continue
                if self.r(2139) <= rw <= self.r(2142):
                    z['amp1002'] = self.val(f, here) - 1
                    continue
            # MAX(…, 0)：加深 / 最终伤害
            if s.kind == 'fn' and s.value == 'MAX' and len(s.args) == 2 and _is_num(s.args[1], 0):
                if self.max_zone(s.args[0], here, z, notes):
                    continue
            # (1 + …)
            ok, sign = _one_plus(f) if f.kind == 'paren' else (False, 0)
            if ok and sign > 0:
                if any(r == self.r(2622) for _, r in cfg):
                    notes.append('「聚爆效应121」因子按 0 类加深并入（TD-06 再定）')
                self.put(z, self.plus_slot(f, here), self.plus_x(f, here), notes)
                continue
            # 暴伤：R1867–R1890 右半，或面板暴伤 F2148
            if first and ((self.r(1867) <= first[1] <= self.r(1890) and first[0] >= col_index('M'))
                          or first == (col_index('F'), self.r(2148))):
                z['crit'] = self.val(f, here)
                continue
            other = (other or 1.0) * self.val(f, here)
            notes.append(f'未归类因子 #{i}：{src[f.span[0]:f.span[1]][:80]}')
        if 'base' not in z:
            return None, '护盾' if '盾' in name else '没有基础项', notes
        if kind == 'whitebar':
            return None, '白条削减', notes
        if kind is None:
            if 'def' in z:
                kind = 'hurt'
            elif 'heal' in z:
                kind = 'heal'
            elif str(g.get('table', '')).startswith('dmg!'):
                kind = 'hurt'                            # 只有基础项的固定伤害（FormulaParam 类，TD-03 Q13）
            else:
                return None, '护盾', notes
        g['formula'] = kind
        if kind != 'hurt':
            g['branch'] = 'nc'
        elif branch == 'cr' and z.get('crit') == 1.0:
            notes.append('暴击列的暴伤因子是 1')
        if other is not None:
            z['other'] = other
        g['z'] = z
        return g, None, notes

    def base_info(self, f: Node, here: str, g: dict) -> None:
        """基础项里第一个倍率 INDEX：MATCH 的键、RateLv 原值、表列"""
        for x in _walk(f):
            if x.kind == 'fn' and x.value == 'INDEX' and x.args and x.args[0].kind == 'ref' \
                    and x.args[0].value.sheet in ('dmg', 'base'):
                ref: Ref = x.args[0].value
                g['table'] = f'{ref.sheet}!{col_letter(ref.c1)}'
                try:
                    g['rate'] = self.val(x, here)
                except XlError:
                    pass
                if len(x.args) > 1:
                    m = strip_paren(x.args[1])
                    if m.kind == 'fn' and m.value == 'MATCH' and m.args:
                        try:
                            k = self.ev.scalar(m.args[0], here)
                            if isinstance(k, str):
                                g['key'] = k
                        except XlError:
                            pass
                return

    def plus_slot(self, f: Node, here: str) -> str:
        cells = set(_cfg_cells(f, here))
        if any(r == self.r(2622) for _, r in cells):
            return 'amp0'          # 「聚爆效应121」：乘在聚爆效应伤害上的独立因子，按效应加深并入 0 类（TD-03 §9.4 漏记，TD-06 再定）
        if (col_index('I'), self.r(2150)) in cells:
            return 'special'
        if (col_index('C'), self.r(2162)) in cells:
            return 'breakBoost'
        if (col_index('S'), self.r(2148)) in cells or (col_index('Q'), self.r(2150)) in cells:
            return 'heal'
        if (col_index('B'), self.r(2164)) in cells:
            return 'fin1001'
        return 'bonus'

    def put(self, z: dict, slot: str, x: float, notes: list[str]) -> None:
        """同一乘区出现两次：按因子相乘合并，并在备注里记一笔"""
        if slot in z:
            notes.append(f'{slot} 出现两次')
            z[slot] = (1 + z[slot]) * (1 + x) - 1
        else:
            z[slot] = x

    def put_class(self, z: dict, key: str, size: int, k: int, x: float, notes: list[str]) -> None:
        arr = z.setdefault(key, [0.0] * size)
        if arr[k] == 0:
            arr[k] = x
        elif x != 0:
            notes.append(f'{key}[{k}] 出现两次')
            arr[k] = (1 + arr[k]) * (1 + x) - 1

    def max_zone(self, arg: Node, here: str, z: dict, notes: list[str]) -> bool:
        inner = strip_paren(arg)
        items = _muldiv_terms(inner) if inner.kind == 'bin' and inner.value == '*' else [(arg, 1)]
        if any(e < 0 for _, e in items) or not all(_one_plus(t)[0] for t, _ in items):
            return False
        if len(items) == 1:
            t = items[0][0]
            cells = _cfg_cells(t, here)
            v = self.plus_x(t, here)
            if not cells:
                self.put(z, 'amp0', v, notes)
                return True
            c, r = cells[0]
            if self.r(1917) <= r <= self.r(2023):
                k = _grid_class(self.cfg, c, r)
                if k is None or not 1 <= k <= 9:
                    notes.append(f'加深类别不认识：{col_letter(c)}{r}')
                    return False
                self.put_class(z, 'amp', 9, k - 1, v, notes)
            elif self.r(2025) <= r <= self.r(2112):
                k = _grid_class(self.cfg, c, r)
                if k is None or not 0 <= k <= 7:
                    notes.append(f'最终伤害类别不认识：{col_letter(c)}{r}')
                    return False
                self.put_class(z, 'fin', 8, k, v, notes)
            elif (self.r(2114) <= r <= self.r(2137) and c >= col_index('M')) or (c, r) == (col_index('B'), self.r(2164)):
                self.put(z, 'fin1001', v, notes)
            else:
                self.put(z, 'amp0', v, notes)
            return True
        n = len(items)
        if n == 9:
            key, size, lo = 'amp', 9, 1
        elif n in (7, 8):
            key, size, lo = 'fin', 8, 0
        else:
            notes.append(f'MAX 里 {n} 项连乘')
            return False
        for pos, (t, _) in enumerate(items):
            cells = _cfg_cells(t, here)
            k = _grid_class(self.cfg, *cells[0]) if cells else None
            if k is None:
                k = lo + pos
            self.put_class(z, key, size, k - lo, self.plus_x(t, here), notes)
        return True


def golden_cells(calc_values: dict, calc_formulas: dict) -> list[tuple[str, str, str]]:
    """标准答案格：角色块（20260707 版 R4–R1026）各列组的未暴击 / 暴击格，两张表（R1039–R1106）里以 CEILING 开头的格。
    返回 [(坐标, 条目名, 'nc' | 'cr')]"""
    out = []
    last, lo, hi = calc_layout(calc_values)
    for r in range(FIRST_ROW, last + 1):
        for start in GROUP_STARTS:
            nc_col, cr_col, _ = _cols(start)
            for col, br in ((nc_col, 'nc'), (cr_col, 'cr')):
                src = calc_formulas.get(f'{col}{r}')
                if isinstance(src, str) and src.startswith('=CEILING'):
                    out.append((f'{col}{r}', str(calc_values.get(f'{start}{r}') or '').strip(), br))
    for coord, src in calc_formulas.items():
        c, r = split_coord(coord)
        if lo <= r <= hi and isinstance(src, str) and src.startswith('=CEILING'):
            out.append((coord, _table_name(calc_values, c, r), 'nc'))
    return out


def _table_name(values: dict, col: int, row: int) -> str:
    """表里的格：往左找本行的层数 / 行名，往上找表头（效应名；谐度破坏表取列头"对失谐伤害"等）"""
    label = None
    for c in range(col - 1, 0, -1):
        v = values.get(f'{col_letter(c)}{row}')
        if isinstance(v, str) and v.strip():
            label = v.strip()
            head_col = c
            break
    else:
        return f'{col_letter(col)}{row}'
    title = None
    for r in range(row - 1, 1026, -1):
        v = values.get(f'{col_letter(head_col)}{r}')
        if isinstance(v, str) and v.strip() and not re.fullmatch(r'\d+层', v.strip()):
            title = v.strip()
            break
    col_head = None
    for r in range(row - 1, 1026, -1):
        v = values.get(f'{col_letter(col)}{r}')
        if isinstance(v, str) and v.strip():
            col_head = v.strip()
            break
    parts = [p for p in (title, label, col_head if col_head not in ('伤害', None) else None) if p]
    return '·'.join(parts)


def golden_zones(ev: Evaluator) -> tuple[list[dict], dict]:
    """返回 (GoldenZone 列表, {skipped: 未纳入原因计数, problems: [(坐标, 条目名, 提示)]})。缓存值取自 ev.values[伤害计算]"""
    calc_v = ev.values.get(CALC, {})
    calc_f = ev.formulas.get(CALC, {})
    cls = Classifier(ev)
    out: list[dict] = []
    skipped: Counter = Counter()
    problems: list[tuple[str, str, str]] = []
    if calc_v:
        missing = [k for k, v in CFG_SECTIONS.items() if v not in cls.shift]
        if missing:
            problems.append(('伤害配置', 'A 列', f'找不到段名 {"、".join(missing)}，这些段按 20260707 版的行号'))
    for coord, name, br in golden_cells(calc_v, calc_f):
        try:
            g, why, notes = cls.classify(coord, calc_f[coord], name, br)
        except (XlError, NotImplementedError, SyntaxError) as e:
            problems.append((coord, name, repr(e)))
            continue
        if g is None:
            skipped[why] += 1
            if why not in ('护盾', '白条削减'):
                problems.append((coord, name, why))
            continue
        expected = calc_v.get(coord)
        if not isinstance(expected, (int, float)):
            problems.append((coord, name, f'缓存值不是数字 {expected!r}'))
            continue
        g['expected'] = expected
        problems += [(coord, name, n) for n in notes]
        out.append(_order(g))
    return out, {'skipped': dict(skipped), 'problems': problems}


_KEY_ORDER = ['cell', 'name', 'branch', 'formula', 'expected', 'key', 'rate', 'table', 'defRef', 'resRef', 'z']
_Z_ORDER = ['base', 'crit', 'def', 'bonus', 'res', 'dr', 'dre', 'special', 'amp', 'fin', 'fin1001', 'amp0', 'amp1002',
            'heal', 'breakBoost', 'vsNormal', 'other']


def _order(g: dict) -> dict:
    out = {k: g[k] for k in _KEY_ORDER if k in g}
    out['z'] = {k: g['z'][k] for k in _Z_ORDER if k in g['z']}
    return out


# ---------------------------------------------------------------------------
# 用 TD-03 §3–§7 的公式重算（与 src/engine/formula.ts 同一乘法顺序，给构建报告与扰动对拍用）

DEF_CAP, HIGH_RES = 2.0, 0.8


def _def_factor(target_def: float, rate: float, ignore: float, level: float) -> float:
    d = target_def * (1 + rate) * (1 - ignore) / (800 + level * 8) + 1
    return DEF_CAP if d <= 0 else min(DEF_CAP, 1 / d)


def _res_factor(r: float) -> float:
    if r <= 0:
        return 1 - r / 2
    if r < HIGH_RES:
        return 1 - r
    return 1 / (1 + r * 5)


def _prod(xs: list[float]) -> float:
    p = 1.0
    for x in xs:
        p = p * (1 + x)
    return p


def recompute(g: dict) -> float:
    """按 GoldenZone 的乘区重算（等价于 tests/td03.test.ts T03-9 的 evaluate）"""
    z = g['z']
    d = z.get('def') or {}
    df = _def_factor(d.get('targetDef', 0), d.get('defRate', 0), d.get('ignore', 0), d.get('level', 90))
    res = _res_factor(z.get('res', 0))
    dr1 = 1 - min(z.get('dr', 0), 1)
    dr2 = 1 - min(z.get('dre', 0), 1)
    amp19 = max(_prod(z.get('amp') or [0] * 9), 0)
    fin07 = max(_prod(z.get('fin') or [0] * 8), 0)
    fin1001 = max(1 + z.get('fin1001', 0), 0)
    amp0 = max(1 + z.get('amp0', 0), 0)
    amp1002 = max(1 + z.get('amp1002', 0), 0)
    special = 1 + max(z.get('special', 0), -1)
    base = z['base']
    f = g['formula']
    if f == 'hurt':
        crit = z.get('crit', 1) if g['branch'] == 'cr' else 1
        bonus = 1 + z.get('bonus', 0) + 0 + 0
        v = base * crit * df * bonus * res * dr1 * dr2 * special * amp19 * fin07 * fin1001 * amp0 * amp1002
    elif f == 'abnormal':
        v = base * 1 * df * res * dr1 * dr2 * special * amp19 * fin07 * fin1001 * amp0 * amp1002
    elif f == 'tune':
        v = base * 1 * df * res * dr1 * dr2 * (1 + z.get('breakBoost', 0) * 100 * 0.01) * fin07
        if z.get('vsNormal'):
            v *= 1 - 0.9999
    else:
        v = (0 * 0 + base) * (0 + z.get('heal', 0) + 0 + 1)
    return float(math.ceil(v))

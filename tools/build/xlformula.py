"""最小的 Excel 公式解析器与求值器（TD-03 §10.1 第 2 步）。

只支持「伤害计算」页标准答案格用到的写法：数字、字符串、布尔、单元格 / 区域引用（可带表名，整列区域），
运算符 `: - % ^ * / + - & = <> < > <= >= `，函数 CEILING FLOOR ROUND MIN MAX SUM IF AND OR INDEX MATCH LEFT
REGEXEXTRACT。区域参与 `&`、比较、算术时按数组逐项计算（`MATCH(x, A:A&C:C, 0)` 这种写法）。

求值读"缓存值"：引用到的格直接取 xlsx 保存时的值，不递归求它的公式；`live` 里的格例外，按公式现算
（扰动对拍时用，TD-03 §10.3）。
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, NamedTuple

# ---------------------------------------------------------------------------
# 语法树


class Node(NamedTuple):
    kind: str                # num str bool ref fn bin un pct paren missing
    value: object = None     # num / str / bool 的值；fn 的函数名；bin / un 的运算符；ref 的 Ref
    args: tuple = ()
    span: tuple[int, int] = (0, 0)   # 在原文里的位置 [start, end)，报告与调试用


@dataclass(frozen=True)
class Ref:
    sheet: str | None        # None = 公式所在的表
    c1: int                  # 列号，1 起；整列区域的行号为 None
    r1: int | None
    c2: int
    r2: int | None

    @property
    def is_cell(self) -> bool:
        return self.c1 == self.c2 and self.r1 == self.r2 and self.r1 is not None

    def cells(self) -> list[list[str]]:
        """区域里每一格的坐标（行优先）；整列区域需要先由求值器定出行数"""
        assert self.r1 is not None and self.r2 is not None
        return [[f'{col_letter(c)}{r}' for c in range(self.c1, self.c2 + 1)] for r in range(self.r1, self.r2 + 1)]

    def text(self) -> str:
        a = f'{col_letter(self.c1)}{self.r1 or ""}'
        b = f'{col_letter(self.c2)}{self.r2 or ""}'
        s = a if (a == b) else f'{a}:{b}'
        return f'{self.sheet}!{s}' if self.sheet else s


def col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def col_letter(n: int) -> str:
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_coord(coord: str) -> tuple[int, int]:
    m = re.fullmatch(r'([A-Z]+)(\d+)', coord)
    if not m:
        raise ValueError(coord)
    return col_index(m.group(1)), int(m.group(2))


# ---------------------------------------------------------------------------
# 词法

_TOKEN = re.compile(r'''
    (?P<ws>\s+)
  | (?P<str>"(?:[^"]|"")*")
  | (?P<ref>(?:(?:'(?:[^']|'')+'|[^\s()*+,/\-=&<>!:'"^%;{}]+)!)?\$?[A-Z]{1,3}(?:\$?\d+)?(?![A-Za-z0-9_(]))
  | (?P<fn>(?:_xlfn\.)?[A-Z][A-Z0-9_.]*(?=\())
  | (?P<bool>TRUE|FALSE)(?![A-Za-z0-9_(])
  | (?P<num>(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)
  | (?P<op><>|<=|>=|[-+*/^&=<>%:,()])
''', re.VERBOSE)


def tokenize(src: str) -> list[tuple[str, str, int, int]]:
    s = src[1:] if src.startswith('=') else src
    off = len(src) - len(s)
    out, i = [], 0
    while i < len(s):
        m = _TOKEN.match(s, i)
        if not m:
            raise SyntaxError(f'无法识别：{s[i:i + 20]!r}')
        kind = m.lastgroup
        if kind != 'ws':
            out.append((kind, m.group(), i + off, m.end() + off))
        i = m.end()
    return out


_REF_PARTS = re.compile(r"(?:(?P<sheet>'(?:[^']|'')+'|[^!]+)!)?\$?(?P<col>[A-Z]{1,3})(?:\$?(?P<row>\d+))?$")


def _parse_ref(text: str) -> tuple[str | None, int, int | None]:
    m = _REF_PARTS.match(text)
    if not m:
        raise SyntaxError(text)
    sheet = m.group('sheet')
    if sheet and sheet.startswith("'"):
        sheet = sheet[1:-1].replace("''", "'")
    return sheet, col_index(m.group('col')), int(m.group('row')) if m.group('row') else None


# ---------------------------------------------------------------------------
# 语法：Excel 优先级（高 → 低）：区域 `:` > 负号 > `%` > `^` > `* /` > `+ -` > `&` > 比较；二元运算左结合

_PREC = {'=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5}


class _Parser:
    def __init__(self, src: str) -> None:
        self.src = src
        self.toks = tokenize(src)
        self.i = 0

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self):
        t = self.toks[self.i]
        self.i += 1
        return t

    def expect(self, text: str):
        t = self.peek()
        if not t or t[1] != text:
            raise SyntaxError(f'期望 {text!r}，得到 {t[1] if t else "结尾"!r}：{self.src}')
        return self.take()

    def parse(self) -> Node:
        n = self.expr(1)
        if self.peek():
            raise SyntaxError(f'多余的 {self.peek()[1]!r}：{self.src}')
        return n

    def expr(self, min_prec: int) -> Node:
        left = self.unary()
        while (t := self.peek()) and t[0] == 'op' and (p := _PREC.get(t[1])) is not None and p >= min_prec:
            self.take()
            right = self.expr(p + 1)
            left = Node('bin', t[1], (left, right), (left.span[0], right.span[1]))
        return left

    def unary(self) -> Node:
        t = self.peek()
        if t and t[0] == 'op' and t[1] in '+-':
            self.take()
            a = self.unary()
            return Node('un', t[1], (a,), (t[2], a.span[1]))
        n = self.primary()
        while (t := self.peek()) and t[0] == 'op' and t[1] == '%':
            self.take()
            n = Node('pct', None, (n,), (n.span[0], t[3]))
        return n

    def primary(self) -> Node:
        kind, text, a, b = self.take()
        if kind == 'num':
            return Node('num', float(text), (), (a, b))
        if kind == 'str':
            return Node('str', text[1:-1].replace('""', '"'), (), (a, b))
        if kind == 'bool':
            return Node('bool', text == 'TRUE', (), (a, b))
        if kind == 'ref':
            sheet, c1, r1 = _parse_ref(text)
            c2, r2, end = c1, r1, b
            if (n := self.peek()) and n[1] == ':':
                self.take()
                k2, t2, _, b2 = self.take()
                if k2 != 'ref':
                    raise SyntaxError(f'区域写法不认识：{self.src[a:b2]}')
                s2, c2, r2 = _parse_ref(t2)
                if s2 not in (None, sheet):
                    raise SyntaxError(f'跨表区域：{self.src[a:b2]}')
                end = b2
            if (r1 is None) != (r2 is None):
                raise SyntaxError(f'区域写法不认识：{self.src[a:end]}')
            if r1 is not None:
                r1, r2 = min(r1, r2), max(r1, r2)
            return Node('ref', Ref(sheet, min(c1, c2), r1, max(c1, c2), r2), (), (a, end))
        if kind == 'fn':
            name = text.removeprefix('_xlfn.')
            self.expect('(')
            args: list[Node] = []
            if self.peek() and self.peek()[1] != ')':
                while True:
                    t = self.peek()
                    args.append(Node('missing', None, (), (t[2], t[2])) if t and t[1] in (',', ')') else self.expr(1))
                    if self.peek() and self.peek()[1] == ',':
                        self.take()
                        continue
                    break
            close = self.expect(')')
            return Node('fn', name, tuple(args), (a, close[3]))
        if text == '(':
            inner = self.expr(1)
            close = self.expect(')')
            return Node('paren', None, (inner,), (a, close[3]))
        raise SyntaxError(f'不认识的 {text!r}：{self.src}')


def parse(src: str) -> Node:
    return _Parser(src).parse()


def strip_paren(n: Node) -> Node:
    while n.kind == 'paren':
        n = n.args[0]
    return n


def refs_in(n: Node) -> list[Ref]:
    out: list[Ref] = []

    def walk(x: Node) -> None:
        if x.kind == 'ref':
            out.append(x.value)
        for a in x.args:
            walk(a)
    walk(n)
    return out


# ---------------------------------------------------------------------------
# 求值


class XlError(Exception):
    """公式求值得到 Excel 错误（#N/A 等）"""


class Array(list):
    """二维数组（行优先），区域展开或数组运算的结果"""

    @property
    def shape(self) -> tuple[int, int]:
        return len(self), len(self[0]) if self else 0


@dataclass(frozen=True)
class Area:
    """还没展开的多格区域（INDEX 只取其中一格时不必展开整块）"""
    sheet: str
    c1: int
    r1: int
    c2: int
    r2: int

    @property
    def shape(self) -> tuple[int, int]:
        return self.r2 - self.r1 + 1, self.c2 - self.c1 + 1


_COLS = [''] + [col_letter(n) for n in range(1, 16385)]


def num_text(x: float) -> str:
    """数字按"常规"格式转成文本（`&` 拼接用）：最多 15 位有效数字"""
    if isinstance(x, bool):
        return 'TRUE' if x else 'FALSE'
    if isinstance(x, int) or (isinstance(x, float) and x.is_integer() and abs(x) < 1e15):
        return str(int(x))
    s = f'{x:.15g}'
    if 'e' in s:
        m, e = s.split('e')
        return f'{m}E{int(e):+03d}'
    return s


def to_text(v) -> str:
    if v is None:
        return ''
    if isinstance(v, str):
        return v
    return num_text(v)


def to_num(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        try:
            return float(s[:-1]) / 100 if s.endswith('%') else float(s)
        except ValueError:
            raise XlError('#VALUE!') from None
    raise XlError('#VALUE!')


def to_bool(v) -> bool:
    if isinstance(v, str):
        if v.upper() in ('TRUE', 'FALSE'):
            return v.upper() == 'TRUE'
        raise XlError('#VALUE!')
    return to_num(v) != 0


def _type_rank(v) -> int:
    if isinstance(v, bool):
        return 2
    if isinstance(v, str):
        return 1
    return 0


def compare(a, b, op: str) -> bool:
    """Excel 比较：空格按 0 / 空串；数字 < 文本 < 布尔；文本不分大小写"""
    if a is None:
        a = '' if isinstance(b, str) else (False if isinstance(b, bool) else 0.0)
    if b is None:
        b = '' if isinstance(a, str) else (False if isinstance(a, bool) else 0.0)
    ra, rb = _type_rank(a), _type_rank(b)
    if ra != rb:
        c = (ra > rb) - (ra < rb)
    elif ra == 1:
        x, y = a.lower(), b.lower()
        c = (x > y) - (x < y)
    else:
        x, y = float(a), float(b)
        c = (x > y) - (x < y)
    return {'=': c == 0, '<>': c != 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0}[op]


def excel_round(x: float, digits: int) -> float:
    """ROUND：四舍五入，远离 0（按十进制表示取整，与 Excel 一致）"""
    q = Decimal(1).scaleb(-digits)
    return float(Decimal(repr(x)).quantize(q, rounding=ROUND_HALF_UP))


def _broadcast(a, b, f: Callable):
    """逐项运算：标量与数组、同形数组、单行 / 单列与二维"""
    if not isinstance(a, Array) and not isinstance(b, Array):
        return f(a, b)
    A = a if isinstance(a, Array) else Array([[a]])
    B = b if isinstance(b, Array) else Array([[b]])
    rows = max(len(A), len(B))
    cols = max(len(A[0]), len(B[0]))
    out = Array()
    for i in range(rows):
        row = []
        for j in range(cols):
            ia, ja = (0 if len(A) == 1 else i), (0 if len(A[0]) == 1 else j)
            ib, jb = (0 if len(B) == 1 else i), (0 if len(B[0]) == 1 else j)
            if ia >= len(A) or ja >= len(A[0]) or ib >= len(B) or jb >= len(B[0]):
                row.append(XlError('#N/A'))
                continue
            x, y = A[ia][ja], B[ib][jb]
            if isinstance(x, XlError) or isinstance(y, XlError):
                row.append(x if isinstance(x, XlError) else y)
                continue
            try:
                row.append(f(x, y))
            except XlError as e:
                row.append(e)
        out.append(row)
    return out


def _flatten(v) -> list:
    if isinstance(v, Array):
        return [x for row in v for x in row]
    return [v]


class Evaluator:
    """在一个工作簿的缓存值上求公式。

    values：{表名: {坐标: 值}}；formulas：同形，求 `live` 里的格时用；
    live：需要按公式现算的格 {(表名, 坐标)}；overrides：改写过的值（扰动对拍）。
    改了 overrides 之后调用 reset()：区域与现算格的缓存只在两次 reset 之间有效。
    """

    def __init__(self, values: dict[str, dict[str, object]], formulas: dict[str, dict[str, object]] | None = None,
                 live: set[tuple[str, str]] | None = None, overrides: dict[tuple[str, str], object] | None = None) -> None:
        self.values = values
        self.formulas = formulas or {}
        self.live = live or set()
        self.overrides = overrides if overrides is not None else {}
        self._memo: dict[tuple[str, str], object] = {}
        self._areas: dict[Area, Array] = {}
        self._max_row: dict[str, int] = {}
        self._parsed: dict[str, Node] = {}

    def reset(self) -> None:
        self._memo.clear()
        self._areas.clear()

    def parsed(self, src: str) -> Node:
        n = self._parsed.get(src)
        if n is None:
            n = self._parsed[src] = parse(src)
        return n

    # --- 单元格与区域
    def cell(self, sheet: str, coord: str):
        key = (sheet, coord)
        if self.overrides and key in self.overrides:
            return self.overrides[key]
        if self.live and key in self.live:
            if key not in self._memo:
                src = self.formulas.get(sheet, {}).get(coord)
                self._memo[key] = self.scalar(self.parsed(src), sheet) if isinstance(src, str) and src.startswith('=') \
                    else self.values.get(sheet, {}).get(coord)
            return self._memo[key]
        return self.values.get(sheet, {}).get(coord)

    def at(self, sheet: str, col: int, row: int):
        return self.cell(sheet, f'{_COLS[col]}{row}')

    def max_row(self, sheet: str) -> int:
        if sheet not in self._max_row:
            rows = [split_coord(k)[1] for k in self.values.get(sheet, {})]
            self._max_row[sheet] = max(rows, default=1)
        return self._max_row[sheet]

    def area(self, ref: Ref, here: str) -> Area:
        sheet = ref.sheet or here
        r1, r2 = (ref.r1, ref.r2) if ref.r1 is not None else (1, self.max_row(sheet))
        return Area(sheet, ref.c1, r1, ref.c2, r2)

    def expand(self, v):
        """Area → Array（同一次 reset 之间缓存）；其余原样返回"""
        if not isinstance(v, Area):
            return v
        a = self._areas.get(v)
        if a is None:
            a = self._areas[v] = Array([[self.at(v.sheet, c, r) for c in range(v.c1, v.c2 + 1)]
                                        for r in range(v.r1, v.r2 + 1)])
        return a

    # --- 表达式
    def eval(self, n: Node, here: str):
        """求值：单格返回值本身；多格区域返回 Area（懒展开）；数组运算返回 Array"""
        k = n.kind
        if k == 'num' or k == 'str' or k == 'bool':
            return n.value
        if k == 'paren':
            return self.eval(n.args[0], here)
        if k == 'ref':
            ref: Ref = n.value
            if ref.is_cell:
                return self.at(ref.sheet or here, ref.c1, ref.r1)
            return self.area(ref, here)
        if k == 'bin':
            a = self.expand(self.eval(n.args[0], here))
            b = self.expand(self.eval(n.args[1], here))
            return _broadcast(a, b, _BINOPS[n.value])
        if k == 'fn':
            f = _FUNCS.get(n.value)
            if f is None:
                raise NotImplementedError(f'函数 {n.value}')
            return f(self, n.args, here)
        if k == 'un':
            v = self.expand(self.eval(n.args[0], here))
            return _broadcast(v, None, _neg if n.value == '-' else _pos)
        if k == 'pct':
            return _broadcast(self.expand(self.eval(n.args[0], here)), None, lambda x, _: to_num(x) / 100)
        if k == 'missing':
            return None
        raise NotImplementedError(k)

    def scalar(self, n: Node, here: str):
        v = self.expand(self.eval(n, here))
        if isinstance(v, Array):
            if v.shape != (1, 1):
                raise XlError('#VALUE!')
            v = v[0][0]
        if isinstance(v, XlError):
            raise v
        return v

    def number(self, n: Node, here: str) -> float:
        return to_num(self.scalar(n, here))


def _neg(x, _):
    return -to_num(x)


def _pos(x, _):
    return to_num(x)


def _arith(op: str):
    def f(x, y):
        a, b = to_num(x), to_num(y)
        if op == '+':
            return a + b
        if op == '-':
            return a - b
        if op == '*':
            return a * b
        if op == '/':
            if b == 0:
                raise XlError('#DIV/0!')
            return a / b
        return a ** b
    return f


_BINOPS: dict[str, Callable] = {op: _arith(op) for op in '+-*/^'}
_BINOPS['&'] = lambda x, y: to_text(x) + to_text(y)
for _op in ('=', '<>', '<', '>', '<=', '>='):
    _BINOPS[_op] = (lambda o: lambda x, y: compare(x, y, o))(_op)


# ---------------------------------------------------------------------------
# 函数


def _fn_ceiling(ev: Evaluator, args, here):
    x = ev.number(args[0], here)
    sig = ev.number(args[1], here) if len(args) > 1 else 1.0
    if sig == 0:
        return 0.0
    return math.ceil(x / sig) * sig


def _fn_floor(ev: Evaluator, args, here):
    x = ev.number(args[0], here)
    sig = ev.number(args[1], here) if len(args) > 1 else 1.0
    if sig == 0:
        raise XlError('#DIV/0!')
    return math.floor(x / sig) * sig


def _fn_round(ev: Evaluator, args, here):
    return excel_round(ev.number(args[0], here), int(ev.number(args[1], here)))


def _numbers(ev: Evaluator, args, here) -> list[float]:
    """MIN / MAX / SUM 的参数：区域里只取数字，直接写的参数按数字转换"""
    out = []
    for a in args:
        v = ev.expand(ev.eval(a, here))
        if isinstance(v, Array):
            for x in _flatten(v):
                if isinstance(x, XlError):
                    raise x
                if isinstance(x, (int, float)) and not isinstance(x, bool):
                    out.append(float(x))
        else:
            out.append(to_num(v))
    return out


def _fn_min(ev, args, here):
    xs = _numbers(ev, args, here)
    return min(xs) if xs else 0.0


def _fn_max(ev, args, here):
    xs = _numbers(ev, args, here)
    return max(xs) if xs else 0.0


def _fn_sum(ev, args, here):
    return sum(_numbers(ev, args, here))


def _fn_if(ev: Evaluator, args, here):
    if to_bool(ev.scalar(args[0], here)):
        return ev.eval(args[1], here) if len(args) > 1 else True
    return ev.eval(args[2], here) if len(args) > 2 else False


def _logic(ev: Evaluator, args, here) -> list[bool]:
    out = []
    for a in args:
        v = ev.expand(ev.eval(a, here))
        for x in _flatten(v):
            if isinstance(x, XlError):
                raise x
            if x is None or (isinstance(x, str) and isinstance(v, Array)):
                continue
            out.append(to_bool(x))
    return out


def _fn_and(ev, args, here):
    return all(_logic(ev, args, here))


def _fn_or(ev, args, here):
    return any(_logic(ev, args, here))


def _fn_index(ev: Evaluator, args, here):
    src = ev.eval(args[0], here)
    row = int(ev.number(args[1], here)) if len(args) > 1 and args[1].kind != 'missing' else 0
    col = int(ev.number(args[2], here)) if len(args) > 2 and args[2].kind != 'missing' else 0
    if isinstance(src, Area):
        rows, cols = src.shape
    elif isinstance(src, Array):
        rows, cols = src.shape
    else:
        src, rows, cols = Array([[src]]), 1, 1
    if rows == 1 and len(args) == 2:          # 单行区域：第二参数是列
        row, col = 1, row
    if cols == 1 and col == 0:
        col = 1
    if row < 0 or col < 0 or row > rows or col > cols:
        raise XlError('#REF!')
    if row == 0 or col == 0:                  # 取整行 / 整列
        arr = ev.expand(src)
        if row == 0 and col == 0:
            return arr
        if row == 0:
            return Array([[r[col - 1]] for r in arr])
        return Array([arr[row - 1]])
    if isinstance(src, Area):
        return ev.at(src.sheet, src.c1 + col - 1, src.r1 + row - 1)
    return src[row - 1][col - 1]


def _fn_match(ev: Evaluator, args, here):
    x = ev.scalar(args[0], here)
    arr = ev.expand(ev.eval(args[1], here))
    mode = ev.number(args[2], here) if len(args) > 2 else 1.0
    items = _flatten(arr) if isinstance(arr, Array) else [arr]
    if mode == 0:
        pat = None
        if isinstance(x, str) and any(ch in x for ch in '*?'):
            pat = re.compile('^' + re.escape(x).replace(r'\*', '.*').replace(r'\?', '.') + '$', re.I | re.S)
        for i, y in enumerate(items, 1):
            if isinstance(y, XlError) or y is None:
                continue
            if pat is not None and isinstance(y, str):
                if pat.match(y):
                    return float(i)
            elif _type_rank(x) == _type_rank(y) and compare(x, y, '='):
                return float(i)
        raise XlError('#N/A')
    # 近似匹配：升序（1）取 ≤ x 的最后一个，降序（-1）取 ≥ x 的最后一个
    best = None
    for i, y in enumerate(items, 1):
        if y is None or isinstance(y, XlError) or _type_rank(x) != _type_rank(y):
            continue
        if (mode > 0 and compare(y, x, '<=')) or (mode < 0 and compare(y, x, '>=')):
            best = i
        else:
            break
    if best is None:
        raise XlError('#N/A')
    return float(best)


def _fn_left(ev: Evaluator, args, here):
    s = to_text(ev.scalar(args[0], here))
    n = int(ev.number(args[1], here)) if len(args) > 1 else 1
    return s[:n]


def _fn_regexextract(ev: Evaluator, args, here):
    """REGEXEXTRACT(文本, 模式, [返回方式], [大小写])：返回第一个匹配（0）、全部匹配（1）或捕获组（2）"""
    s = to_text(ev.scalar(args[0], here))
    pat = to_text(ev.scalar(args[1], here))
    mode = int(ev.number(args[2], here)) if len(args) > 2 and args[2].kind != 'missing' else 0
    flags = re.I if len(args) > 3 and ev.number(args[3], here) == 1 else 0
    m = re.search(pat, s, flags)
    if not m:
        raise XlError('#N/A')
    if mode == 0:
        return m.group(0)
    if mode == 2:
        return Array([list(m.groups())])
    return Array([[x] for x in re.findall(pat, s, flags)])


_FUNCS: dict[str, Callable] = {
    'CEILING': _fn_ceiling, 'FLOOR': _fn_floor, 'ROUND': _fn_round,
    'MIN': _fn_min, 'MAX': _fn_max, 'SUM': _fn_sum,
    'IF': _fn_if, 'AND': _fn_and, 'OR': _fn_or,
    'INDEX': _fn_index, 'MATCH': _fn_match, 'LEFT': _fn_left, 'REGEXEXTRACT': _fn_regexextract,
}

"""TD-01 §4.3、§11.2 / TD-03 §5：异常效应 → effects.json（不需要 xlsx）。

运行：pnpm test:py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openpyxl.utils import column_index_from_string as ci  # noqa: E402
from base_cols import BaseCols  # noqa: E402
from effects import build_effects  # noqa: E402
from parse import Issues  # noqa: E402

# 「伤害计算」R1117（20261019 版）
DESC = ('每层持续15秒，重复获得刷新持续时间，常规上限10层。每5秒结算1次对应层数倍率异常伤害、移除当前层数50%的异常层数。'
        '层数达到上限后，可额外叠加至多10层电磁爆发层数，下次结算电磁效应伤害时，额外附加当前电磁爆发层数倍率。处于无敌状态时不生效。')


def dmg_entry(row: int, element: int, sub: int, rates: list) -> dict:
    cells = [None] * 110
    cells[8], cells[10] = element, sub                                # Element（I）、SubType（K）
    for k, v in enumerate(rates):
        cells[33 + k] = v                                             # RateLv_1…（AH 起）
    return {'row': row, 'cells': cells}


def base_row(**cells):
    r = [None] * 45
    for k, v in cells.items():
        r[ci(k) - 1] = v
    return r


class 异常效应(unittest.TestCase):
    def test_逐层倍率到最后一个非零_元素_说明_基础值(self):
        em = [5000, 9065, 13130, 17195, 21260, 25325, 29390, 33455, 37520, 41585, 55447, 69308, 83170, 97032, 110893, 124755]
        dmg = {
            ('异常伤害', '电磁效应'): dmg_entry(40, 3, 1002, em + [0, 0, 0, 0]),
            ('异常伤害', '霜冻效应'): dmg_entry(45, 1, 10031007, [2450, 4442]),
            ('异常伤害', '空行'): dmg_entry(47, 3, 1002, []),          # 没有倍率：警告、不收
            ('电磁效应', '电磁效应'): dmg_entry(48, 3, 1002, [1]),     # 别的块：不算
        }
        calc = [
            [None, '光噪效应（对目标）', None, '倍率'],
            ['其他', '异常伤害', None, '效果描述'],
            [None, '电磁效应', None, DESC],
            [None, '霜冻效应（替换霜渐）', None, '每层持续15秒……'],
            [None, None, None, None],
            [None, '虚湮效应', None, '表外的不读'],
        ]
        base = [base_row(AM=lv, AN=11 if lv < 3 else 40 * lv) for lv in range(1, 101)]
        base[89] = base_row(AM=90, AN=3674)
        issues = Issues()
        e = build_effects(dmg, calc, base, BaseCols.reference(), issues)
        em_ = e['effects'][0]
        self.assertEqual((em_['name'], em_['element'], em_['subType'], em_['maxStacks']), ('电磁效应', '导电', 1002, 16))
        self.assertEqual(em_['multipliers'][:2], [0.5, 0.9065])
        self.assertEqual(em_['multipliers'][9], 4.1585)                # 10 层（常规上限）
        self.assertEqual(em_['desc'], DESC)
        self.assertEqual([(x['name'], x['element'], x['multipliers'], x['desc']) for x in e['effects'][1:]],
                         [('霜冻效应', '冷凝', [0.245, 0.4442], '每层持续15秒……')])
        self.assertEqual(e['abnormalBaseByLevel'][:3], [11, 11, 120])
        self.assertEqual(e['abnormalBaseByLevel'][89], 3674)
        self.assertEqual(issues.count('warn'), 1)                       # 空行没有倍率


if __name__ == '__main__':
    unittest.main()
